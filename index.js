const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const { Client, LocalAuth } = require('whatsapp-web.js');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

let lastQR = null;
let isAuthenticated = false;

const respuestasEnviadas = new Map(); // Almacena respuestas previas por usuario

app.use(express.json());
app.use(express.static('public'));

function iniciarCliente() {
    const client = new Client({
        authStrategy: new LocalAuth(),
        puppeteer: {
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        }
    });

    client.on('qr', (qr) => {
        lastQR = qr;
        console.log('[QR] Escanea este código QR:\n', qr);
        io.emit('qr', qr);
    });

    client.on('ready', () => {
        console.log('✅ Cliente de WhatsApp listo');
        isAuthenticated = true;
    });

    app.get('/', (req, res) => {
        if (isAuthenticated) {
            res.send('✅ Cliente autenticado');
        } else {
            res.sendFile(path.join(__dirname, 'public', 'index.html'));
        }
    });

    app.post("/verificar", async (req, res) => {
        const { codigo, numero, nombre } = req.body;
        if (!codigo || !numero) {
            return res.status(400).send("Faltan parámetros.");
        }

        const mensajes = [
            `Hola ${nombre}, tu código es *${codigo}*`,
            `Recuerda que la aplicación es *GRATIS*. No pagues a nadie. Si alguien intenta venderte la aplicación, repórtalo escribiendo *reporte*.`,
            `El link de la aplicación de Yape y BCP están en mi perfil. Puedes descargarlas gratuitamente.`
        ];

        const chatId = `51${numero}@c.us`;

        try {
            for (const msg of mensajes) {
                await client.sendMessage(chatId, msg);
            }
            console.log("✅ Mensajes enviados");
            res.status(200).send("Mensaje enviado.");
        } catch (error) {
            console.error("❌ Error:", error);
            res.status(500).send("Error al enviar mensaje.");
        }
    });

    client.on('message', async message => {
        if (!message.from.endsWith('@c.us')) return;

        const now = Date.now();
        const lines = message.body.split("\n");
        const nameMatch = lines.find((line) => line.startsWith("Mi nombre es:"));
        const planRaw = lines.find((line) => line.startsWith("El Plan:"));
        const emailLine = lines.find((line) => line.startsWith("Mi correo:"));
        const email = emailLine ? emailLine.split(": ")[1].trim() : null;


        const name = nameMatch ? nameMatch[1].trim().replace(/\b\w/g, l => l.toUpperCase()) : 'Usuario';

        let paymentLink = '';
        let planNombre = '';

        const planTexto = planRaw.toLowerCase();

        if (planTexto.includes('basico')) {
            planNombre = 'BASICO';
            paymentLink = 'https://mpago.la/27YChM5';
        } else if (planTexto.includes('medium')) {
            planNombre = 'MEDIUM';
            paymentLink = 'https://mpago.la/32sJQmv';
        } else {
            console.log("❌ Plan inválido detectado:", planRaw);
            return;
        }


        const userData = respuestasEnviadas.get(message.from);

        if (userData && userData.email === email && userData.plan === planNombre) {
            const unaHora = 60 * 60 * 1000;
            if (now - userData.lastSent < unaHora) {
                console.log("No se envio el mensaje")
                return; // ❌ Ya respondido hace menos de 1h
            }
        }

        const msg1 = `Hola *${name}*, para activar tu plan *${planNombre}*, realiza el pago aquí:\n🔗 ${paymentLink}`;
        const msg2 = `A continuación, te dejo los pasos para realizar el pago:

1. Da click en _"Transferencia vía Pago Efectivo"_.

2. ⚠️ Selecciona *BCP*.

3. Coloca tu correo: ${email}.

4. Dale click en "*Pagar*".

5. Abre tu billetera móvil (Yape, BCP, Interbank, etc.), busca la opción de pagar servicios.

6. Busca "*PagoEfectivo*" y coloca el código ⚠️ *sin espacios*.
7. ¡Dale click a pagar y listo! Enviame la cap del pago.

Si tienes algún problema, no dudes en decírmelo.
        `;
        await message.reply(msg1);
        setTimeout(() => client.sendMessage(message.from, msg2), 3000);

        // Guardar en memoria
        respuestasEnviadas.set(message.from, {
            email,
            plan: planNombre,
            lastSent: now
        });
    });

    client.on('disconnected', reason => {
        console.log('🔁 Cliente desconectado:', reason);
        setTimeout(() => iniciarCliente(), 5000);
    });

    client.initialize();
}

iniciarCliente();

server.listen(3000, () => {
    console.log('🟢 Servidor escuchando en http://localhost:3000');
});
