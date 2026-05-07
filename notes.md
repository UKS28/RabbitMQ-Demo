1. first of all you need to create a tcp connection
2. on the connection you need to create a channel and channel is like medium through which you can listen and send the message to the queue
3. Configuration: Queue and message durability: can be configured : durable: true,
  arguments: { 'x-queue-type': 'quorum' }
4. Sending: Buffer.from(msg) > send message in form of buffers
5. receiving:

message acknowlegement: 
    // noack: true, means that message will be deleted from queue as soon as it is received.
    // noack: false, means that message will be deleted from queue only after the consumer acknowledges it.

## 1) Connection (TCP Connection)

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

---

# 3) Queue

Queue stores messages until a consumer processes them.

```text
[ msg1 ] [ msg2 ] [ msg3 ]
```

Producer sends messages to queue.
Consumer reads messages from queue.

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

---

# 5) Quorum Queue

```js
arguments: {
  'x-queue-type': 'quorum'
}
```

Quorum queue:

- Uses Raft consensus
- Replicates messages
- Better fault tolerance
- More reliable than classic queues

```text
Leader → Followers → Majority confirmation
```

---

# 6) Sending Messages

```js
channel.sendToQueue(queue, Buffer.from(msg))
```

### Why `Buffer.from(msg)`?

RabbitMQ sends data as bytes.

```text
"Hello" → Buffer → RabbitMQ
```

---

# 7) Receiving Messages

```js
channel.consume(queue, (msg) => {
  console.log(msg.content.toString())
})
```

RabbitMQ pushes messages to consumers.

```text
Producer → Queue → Consumer
```

---

# 8) Message Acknowledgement (Very Important)

## `noAck: true`

```js
{
  noAck: true
}
```

Message is deleted immediately after delivery.

```text
Queue → Consumer → Deleted
```

Problem:
If consumer crashes after receiving message → message is lost.

---

## `noAck: false`

```js
{
  noAck: false
}
```

RabbitMQ waits for explicit acknowledgement.

```js
channel.ack(msg)
```

Flow:

```text
Queue → Consumer → Unacked → ACK → Deleted
```

If consumer crashes before ACK:

```text
Queue → Consumer → Crash → Message requeued
```

This provides better reliability.

---

# 9) Message States

### Ready

Waiting inside queue

### Unacked

Delivered to consumer but waiting for ACK

### Deleted

Removed after ACK

---

# 10) Producer and Consumer use different channels

Producer:

```text
Connection A → Channel A → Queue
```

Consumer:

```text
Queue → Channel B → Connection B
```

They do NOT share the same channel.

They communicate through the **same queue name**.

---

# 11) Why `setTimeout()` in sender?

```js
setTimeout(() => {
  connection.close()
}, 500)
```

This gives RabbitMQ time to receive the message before connection closes.

Without delay:

```text
send message → close immediately → possible message loss
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
Queue
   ↓
Consumer
   ↓
ACK
   ↓
Message Deleted
```

---

# Mental Model

- Connection → road to RabbitMQ
- Channel → lane on the road
- Queue → storage room
- Message → package
- Consumer → worker
- ACK → confirmation that work is done

This is the core RabbitMQ flow.

PREFETCH(1)

`prefetch` method with the value of `1`. This tells RabbitMQ not to give more than one message to a worker at a time. Or, in other words, don't dispatch a new message to a worker until it has processed and acknowledged the previous one. Instead, it will dispatch it to the next worker that is not still busy

if i have multiple receive instances then only single instance will receive the message and this will be in round robin fashion.

todo:

1 read about the amqp protocol

2 learn about their ui what are they all

3 learn about exchange

4 theory learn



[https://www.rabbitmq.com/docs](https://www.rabbitmq.com/docs)

[https://www.rabbitmq.com/tutorials/tutorial-five-javascript](https://www.rabbitmq.com/tutorials/tutorial-five-javascript)