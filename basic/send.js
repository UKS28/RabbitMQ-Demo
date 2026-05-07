const amqp = require('amqplib');
// declare the queue name and message


async function main() {
    // connect with rabbitmq server
    const connection = await amqp.connect('amqp://localhost');
    // create a channel
    const channel = await connection.createChannel();
    const queue = 'hello';
    const msg = 'Hello World90';
    await channel.assertQueue(queue, {
        durable: true,
        arguments: { 'x-queue-type': 'quorum' }
    });
    channel.sendToQueue(queue, Buffer.from(msg));

    console.log(" [x] Sent %s", msg);

    setTimeout(function() {
        connection.close();
        process.exit(0);
    }, 500);
}

main();