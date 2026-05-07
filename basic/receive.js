#!/usr/bin/env node

const amqp = require('amqplib');

async function main() {
    const connection = await amqp.connect('amqp://localhost');
    const channel = await connection.createChannel();

    const queue = 'hello';

    await channel.assertQueue(queue, {
        durable: true,
        arguments: { 'x-queue-type': 'quorum' }
    });


    // noack: true, means that message will be deleted from queue as soon as it is received.
    // noack: false, means that message will be deleted from queue only after the consumer acknowledges it.

    console.log(" [*] Waiting for messages in %s. To exit press CTRL+C", queue);

    channel.consume(queue, function(msg) {
        console.log(" [x] Received %s", msg.content.toString());
        channel.ack(msg);
    }, {
        noAck: false
    });
}

main();