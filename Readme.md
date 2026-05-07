# RabbitMQ Notes

---

# 1) Connection (TCP Connection)

First, your application needs to connect to RabbitMQ.

```js
const connection = await amqp.connect('amqp://localhost');
```

This creates a **real TCP connection** between your app and RabbitMQ.

```text
Your App  ---- TCP Connection ----> RabbitMQ
```

Why?

- RabbitMQ runs as a separate server/process.
- Your app needs a network connection to communicate with it.

---

# 2) Channel

After creating a connection, you create a channel.

```js
const channel = await connection.createChannel();
```

A **channel is a lightweight communication lane inside a TCP connection.**

```text
1 TCP Connection
   |
   ├── Channel 1
   ├── Channel 2
   ├── Channel 3
```

Through a channel you can:

- Create queues
- Send messages
- Consume messages
- Acknowledge messages

### Important

Channel is **NOT**:

- a queue ❌
- the actual TCP connection ❌

Channel is simply a medium to talk to RabbitMQ.

Why channels instead of new connections?
Opening a TCP connection is expensive. Channels are cheap multiplexed "virtual connections" on top of one TCP connection. You can create thousands of channels without performance cost.

---

# 3) Queue

Queue stores messages until a consumer processes them.

```text
[ msg1 ] [ msg2 ] [ msg3 ]
```

Producer sends messages to queue.
Consumer reads messages from queue.

```js
await channel.assertQueue('my_queue', { durable: true });
```

`assertQueue` creates the queue if it does not already exist, or does nothing if it already exists with the same settings.

---

# 4) Queue Durability

```js
await channel.assertQueue(queue, {
  durable: true
})
```

This means:

✅ Queue survives RabbitMQ restart

Without this:

❌ Queue disappears after restart

Note: Queue durability alone does not guarantee message persistence. You also need to mark messages as persistent when publishing:

```js
channel.sendToQueue(queue, Buffer.from(msg), { persistent: true });
```

Both `durable: true` on the queue AND `persistent: true` on the message are needed for full durability.

---

# 5) Quorum Queue

```js
await channel.assertQueue(queue, {
  durable: true,
  arguments: {
    'x-queue-type': 'quorum'
  }
})
```

Quorum queue:

- Uses the **Raft consensus algorithm** — a majority of nodes must agree before a message is confirmed.
- Replicates messages across multiple nodes in a cluster.
- Better fault tolerance — if one node goes down, others hold the data.
- More reliable than classic queues for production use.

```text
Leader → Followers → Majority confirmation
```

Classic queue vs Quorum queue:

| Feature          | Classic Queue | Quorum Queue |
|------------------|---------------|--------------|
| Replication      | Optional      | Always       |
| Consensus        | No            | Raft         |
| Data safety      | Lower         | Higher       |
| Recommended for  | Dev/test      | Production   |

---

# 6) Sending Messages

```js
channel.sendToQueue(queue, Buffer.from(msg))
```

### Why `Buffer.from(msg)`?

RabbitMQ sends data as raw bytes over the network, not as JavaScript strings.

```text
"Hello" → Buffer<48 65 6c 6c 6f> → RabbitMQ
```

On the receiving end, you convert it back:

```js
msg.content.toString()
```

---

# 7) Receiving Messages

```js
channel.consume(queue, (msg) => {
  if (msg !== null) {
    console.log(msg.content.toString());
    channel.ack(msg);
  }
}, { noAck: false });
```

RabbitMQ **pushes** messages to consumers (the broker drives delivery, not the consumer polling).

```text
Producer → Queue → Consumer (push-based)
```

---

# 8) Message Acknowledgement (Very Important)

## `noAck: true`

```js
channel.consume(queue, (msg) => {
  console.log(msg.content.toString());
}, { noAck: true });
```

Message is deleted from the queue immediately after delivery, before the consumer processes it.

```text
Queue → Consumer → Deleted immediately
```

Problem: If the consumer crashes after receiving but before finishing work → **message is permanently lost**.

Use only when occasional message loss is acceptable (e.g. real-time metrics, logs).

---

## `noAck: false` (recommended)

```js
channel.consume(queue, (msg) => {
  // do work...
  channel.ack(msg);  // explicitly acknowledge after work is done
}, { noAck: false });
```

RabbitMQ waits for an explicit acknowledgement before deleting the message.

Flow:

```text
Queue → Consumer → Unacked → work done → ACK → Deleted
```

If consumer crashes before sending ACK:

```text
Queue → Consumer → Crash → Message requeued → Redelivered to another consumer
```

This provides **at-least-once delivery** — the message will be retried.

### Negative Acknowledgement (nack)

If the consumer wants to reject a message and requeue it:

```js
channel.nack(msg, false, true);  // (msg, allUpTo, requeue)
```

If `requeue` is `false`, the message is discarded or sent to a Dead Letter Exchange (DLX).

---

# 9) Message States

### Ready

Waiting inside the queue, not yet delivered to any consumer.

### Unacked

Delivered to a consumer but the consumer has not yet sent an ACK. RabbitMQ holds the message until ACK or consumer disconnects.

### Deleted

Removed from the queue after a successful ACK.

```text
Ready → Unacked → Deleted
           ↓ (crash)
         Requeued → Ready again
```

---

# 10) Producer and Consumer Use Different Channels

Producer:

```text
Connection A → Channel A → Exchange → Queue
```

Consumer:

```text
Queue → Channel B → Connection B
```

They do NOT share the same channel.

They communicate through the **same queue name** (or exchange + binding key).

---

# 11) Why `setTimeout()` in the Sender?

```js
setTimeout(() => {
  connection.close();
}, 500);
```

This gives RabbitMQ time to receive and confirm the message before the connection closes.

Without delay:

```text
send message → close immediately → possible message loss
```

A cleaner alternative is to use the `drain` event or `await` a confirm channel, but `setTimeout` is simple enough for scripts.

---

# 12) Prefetch

```js
channel.prefetch(1);
```

This tells RabbitMQ: **do not send more than 1 unacknowledged message to this consumer at a time.**

Without prefetch:

```text
RabbitMQ dispatches ALL messages to consumers at once (round-robin).
A slow worker gets 100 messages, a fast worker gets 100 messages.
Fast worker is idle while slow worker is overwhelmed.
```

With `prefetch(1)`:

```text
Worker 1 gets msg1 → processes → ACK → gets msg3
Worker 2 gets msg2 → processes → ACK → gets msg4
```

This creates **fair dispatch** — busier workers get fewer new messages.

If you have multiple consumer instances, each processes one message at a time and new messages are only dispatched after the previous one is acknowledged.

---

# 13) Publish / Subscribe (Fanout Exchange)

In a basic queue setup, each message is consumed by **only one** consumer.

Publish/Subscribe delivers a message to **all** consumers simultaneously.

```text
Producer → Exchange → Queue A → Consumer 1
                    → Queue B → Consumer 2
                    → Queue C → Consumer 3
```

The key is the **Exchange**.

### Creating a Fanout Exchange

```js
await channel.assertExchange('logs', 'fanout', { durable: false });
```

### Publishing to an Exchange

```js
channel.publish('logs', '', Buffer.from(msg));
// ('exchange name', 'routing key', message)
// routing key is '' for fanout — all queues receive it
```

### Consumer Binds Its Queue to the Exchange

```js
const q = await channel.assertQueue('', { exclusive: true });
// exclusive: true → temporary queue, deleted when consumer disconnects

await channel.bindQueue(q.queue, 'logs', '');

channel.consume(q.queue, (msg) => {
  console.log(msg.content.toString());
}, { noAck: true });
```

Each consumer creates its own temporary queue and binds it to the exchange. Every bound queue receives every message.

---

# 14) Exchange

The producer **never sends directly to a queue**. It always sends to an **exchange**.

```text
Producer → Exchange → Queue(s) → Consumer(s)
```

The exchange decides what to do with a message based on its **type** and **routing rules**.

### Default Exchange

When you use `channel.sendToQueue(...)`, you are actually using the **default exchange** (empty string `""`).

```js
channel.publish('', 'my_queue', Buffer.from(msg));
// same as:
channel.sendToQueue('my_queue', Buffer.from(msg));
```

The default exchange routes messages directly to a queue whose name matches the routing key.

### Exchange Types

| Type      | Routing Logic                                              |
|-----------|------------------------------------------------------------|
| `fanout`  | Sends to **all** bound queues, ignores routing key         |
| `direct`  | Sends to queues whose binding key **exactly matches** the routing key |
| `topic`   | Sends to queues whose binding key **matches a pattern** (wildcards `*` and `#`) |
| `headers` | Routes based on message **header attributes**, ignores routing key |

---

# 15) Binding

A **binding** is a link between an exchange and a queue.

```js
await channel.bindQueue(queue, exchange, routingKey);
```

It tells the exchange: "send messages with this routing key to this queue."

```text
Exchange ──[binding: routingKey]──> Queue
```

A queue can have multiple bindings from different exchanges or with different routing keys.

---

# 16) Routing Key

A **routing key** is a string attached to a message when it is published.

```js
channel.publish('exchange_name', 'routing.key.here', Buffer.from(msg));
```

The exchange uses the routing key to decide which queue(s) should receive the message.

### How it works per exchange type

**Fanout** — ignores routing key, sends to all bound queues.

**Direct** — sends only to queues bound with a key that **exactly equals** the routing key.

```text
Routing key: "error"
Bound with:  "error"  → ✅ receives
Bound with:  "info"   → ❌ skipped
```

```js
await channel.assertExchange('direct_logs', 'direct', { durable: false });
channel.publish('direct_logs', 'error', Buffer.from('Something broke'));

// Consumer only binds to 'error' severity:
await channel.bindQueue(q.queue, 'direct_logs', 'error');
```

**Topic** — routing key is a dot-separated string (e.g. `kern.critical`). Binding patterns use:

- `*` — matches exactly one word
- `#` — matches zero or more words

```text
Routing key:  "kern.critical"
Pattern:      "kern.*"    → ✅ matches
Pattern:      "#.critical" → ✅ matches
Pattern:      "*.info"     → ❌ no match
```

```js
await channel.assertExchange('topic_logs', 'topic', { durable: false });
channel.publish('topic_logs', 'kern.critical', Buffer.from(msg));

await channel.bindQueue(q.queue, 'topic_logs', 'kern.*');
```

---

# Full Flow

```text
Producer
   ↓
TCP Connection
   ↓
Channel
   ↓
Exchange  ←── routing key
   ↓
Queue(s)
   ↓
Consumer
   ↓
ACK
   ↓
Message Deleted
```

---

# Mental Model

| Concept    | Mental Model                          |
|------------|---------------------------------------|
| Connection | Road to RabbitMQ                      |
| Channel    | Lane on the road                      |
| Exchange   | Post office sorting room              |
| Queue      | Individual mailbox                    |
| Binding    | Address label on the mailbox          |
| Routing key| Destination written on the envelope   |
| Message    | Package / letter                      |
| Consumer   | Recipient / worker                    |
| ACK        | Signed delivery confirmation          |

---

# References

- [RabbitMQ Official Docs](https://www.rabbitmq.com/docs)
- [RabbitMQ Tutorial 5 (Topics) — JavaScript](https://www.rabbitmq.com/tutorials/tutorial-five-javascript)
