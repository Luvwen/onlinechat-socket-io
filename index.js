const express = require('express');
const path = require('path');
const { createServer } = require('http');
const { Server } = require('socket.io');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const { availableParallelism } = require('os');
const cluster = require('cluster');
const { createAdapter, setupPrimary } = require('@socket.io/cluster-adapter');

if (cluster.isPrimary) {
    const numCPUs = availableParallelism();
    // create one worker per available core

    // replace i < 3 for i < numCPUs
    for (let i = 0; i < 3; i++) {
        cluster.fork({
            PORT: 3000 + i,
        });
    }

    // set up the adapter on the primary thread
    return setupPrimary();
}

const main = async () => {
    const db = await open({
        filename: 'chat.db',
        driver: sqlite3.Database,
    });

    await db.exec(`
    CREATE TABLE IF NOT EXISTS messages(
        id INTEGER PRIMARY KEY AUTOINCREMENT, 
        client_offset TEXT UNIQUE, 
        content TEXT)
        `);

    const app = express();
    const server = createServer(app);
    const io = new Server(server, {
        connectionStateRecovery: {},
        adapter: createAdapter(),
    });

    app.get('/', (req, res) => {
        res.sendFile(path.join(__dirname, 'index.html'));
    });

    const names = [
        'Santiago',
        'Melanie',
        'Sandra',
        'Mariano',
        'Fernanda',
        'Claudio',
        'Mauricio',
        'Agustina',
        'Guillermo',
        'German',
    ];
    io.on('connection', async (socket) => {
        const loggedUserId = socket.id;
        const selectedName = names[Math.floor(Math.random() * 10)];
        socket.data.username = selectedName;
        console.log('Login', socket.data.username);
        const response = {
            message: 'Usuario conectado',
            loggedUserId: loggedUserId,
            username: selectedName,
        };
        socket.broadcast.emit('login', response);

        socket.on('chat message', async (msg, clientOffset, callback) => {
            let result;
            try {
                result = await db.run(
                    'INSERT INTO messages(content, client_offset) VALUES (?, ?)',
                    msg,
                    clientOffset,
                );
            } catch (error) {
                if (error.errno === 19) {
                    callback();
                }
                return;
            }

            io.emit('chat message', msg, result.lastID);
            callback();
        });

        socket.on('disconnect', () => {
            const loggedOutId = socket.id;
            console.log('LOGOUT', socket.data.username);
            const username = socket.data.username;
            const response = {
                message: 'Usuario desconectado',
                loggedOutId: loggedOutId,
                username: username,
            };

            socket.broadcast.emit('logout', response);
        });
        if (!socket.recovered) {
            try {
                await db.each(
                    'SELECT id, content FROM messages WHERE id > ?',
                    [socket.handshake.auth.serverOffset || 0],
                    (err, row) => {
                        socket.emit('chat message', row.content, row.id);
                    },
                );
            } catch (err) {
                console.log(err);
            }
        }
    });

    const port = process.env.PORT || 3000;

    server.listen(port, () => {
        console.log(`server running at http://localhost:${port}`);
    });
};

main();
