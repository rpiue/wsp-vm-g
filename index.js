const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const { Client, LocalAuth } = require('whatsapp-web.js');
const { generarLinkPago, ACCESS_TOKEN } = require('./pago');
const { acortarLink } = require('./acortador');

const path = require('path');
const axios = require('axios');
const {
    fetchEmailsFromFirestore,
    findEmailInCache,
    darPlan,
} = require("./db/dato-firebase");



const app = express();
const server = http.createServer(app);
const io = socketIo(server);

let lastQR = null;
let isAuthenticated = false;

const respuestasEnviadas = new Map();
const planUser = new Map();


app.use(express.json());
app.use(express.static('public'));
  

app.post('/webhook', async (req, res) => {
    const { type, data } = req.body;
    if (type === 'payment') {

        const paymentId = data.id;

        try {
            const payment = await axios.get(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
                headers: {
                    Authorization: `Bearer ${ACCESS_TOKEN}`
                }
            });

            const pago = payment.data;

            if (pago.status === 'approved') {
                const emailPagador = pago.payer.email;
                const userData = planUser.get(emailPagador);



                if (userData && userData.numero && userData.plan && userData.nombre) {
                    await darPlan(emailPagador, userData.plan)
                    // 🔁 Enviar POST a /confirmar con los datos
                    await axios.post('https://f4ee-38-224-225-141.ngrok-free.app/confirmar', {
                        nombre: userData.nombre,
                        numero: userData.numero,
                        plan: userData.plan
                    });

                    //console.log("📤 POST a /confirmar enviado");
                } else {
                    //console.log(`⚠️ No se encontró la información para ${emailPagador}`);
                }
            }

        } catch (err) {
            //console.error('❌ Error consultando pago:', err.response?.data || err.message);
        }
    }

    res.sendStatus(200);
});

function calcularFechaVencimiento() {
    const hoy = new Date();
    const año = hoy.getFullYear();
    const mes = hoy.getMonth();
    const dia = hoy.getDate();

    // Crear fecha tentativa sumando un mes
    const fechaTentativa = new Date(año, mes + 1, dia);

    // Si el día se desborda (como 30 feb), el objeto lo ajusta solo al último día válido
    return fechaTentativa.toLocaleDateString('es-PE', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
}


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

    client.on('ready', async () => {
        console.log('✅ Cliente de WhatsApp listo');
        isAuthenticated = true;
        await fetchEmailsFromFirestore();

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

    app.post("/confirmar", async (req, res) => {
        const { plan, numero, nombre } = req.body;
        if (!plan || !numero) {
            return res.status(400).send("Faltan parámetros.");
        }
        console.log(numero)
        const fechaVencimiento = calcularFechaVencimiento();

        const mensajes = [
            `✅ Hola *${nombre}*, tu *Plan ${plan}* esta activado`,
            `🕒 Recuerda que la duración del plan es de *un mes*, por lo que vence el *${fechaVencimiento}*.`,
            `Si estas en un nuevo dispositivo y te sale *Error de dispositivo*, escribeme para darte acceso a tu nuevo dispositivo.`
        ];

        const chatId = numero;

        function esperar(ms) {
            return new Promise(resolve => setTimeout(resolve, ms));
        }

        try {
            for (const msg of mensajes) {
                await client.sendMessage(chatId, msg);
                await esperar(7000); // Espera 2 segundos entre mensajes
            }
            console.log("✅ Mensajes enviados");
            res.status(200).send("Mensaje enviado.");
        } catch (error) {
            console.error("❌ Error: al confirmar",);
            //res.status(500).send("Error al enviar mensaje.");
        }
    });


    client.on('message', async message => {
        if (!message.from.endsWith('@c.us')) return;
        const planRegex = /Plan (Basico|Medium|Premium) - (Yape|BCP) Fake/i;


        if (planRegex.test(message.body)) {
            const pagoFakeRegex = /(Yape|BCP)\s*Fake/i;
            const match = message.body.match(pagoFakeRegex);
            let appSolicitud = "Yape"
            if (!match) {
                console.log("❌ No se detectó ni Yape Fake ni BCP Fake");
            } else {
                appSolicitud = match[1];

            }
            const now = Date.now();
            const lines = message.body.split("\n").map(line => line.trim());

            // Extraer campos
            const nameLine = lines.find(line => line.toLowerCase().startsWith("mi nombre es:"));
            const planLine = lines.find(line => line.toLowerCase().startsWith("el plan:"));
            const emailLine = lines.find(line => line.toLowerCase().startsWith("mi correo:"));

            // Obtener valores limpios
            const name = nameLine ? nameLine.split(":")[1].trim() : "Usuario";
            const email = emailLine ? emailLine.split(":")[1].trim() : null;

            const exists = findEmailInCache(email);
            
            let planNombre = '';
            let monto = '';

            const planTexto = planLine.toLowerCase();

            if (planTexto.includes('basico')) {
                planNombre = 'Basico';
                monto = 30;
            } else if (planTexto.includes('medium')) {
                planNombre = 'Medium';
                monto = 35;
                //paymentLink = 'https://mpago.la/32sJQmv';
            } else {
                console.log("❌ Plan inválido detectado:", planRaw);
                return;
            }

            
            const userData = respuestasEnviadas.get(message.from);

            if (userData && userData.email === email && userData.plan === planNombre && userData.app === appSolicitud) {
                const unaHora = 60 * 60 * 1000;
                if (now - userData.lastSent < unaHora) {
                    //console.log("No se envio el mensaje")
                    return; // ❌ Ya respondido hace menos de 1h
                }
            }

            if (!exists) {
                client.sendMessage(message.from, 'Envianos un audio para verificar.')
                respuestasEnviadas.set(message.from, {
                    app: appSolicitud,
                    email,
                    plan: planNombre,
                    lastSent: now
                });
                return;
            }

            const paymentLink = await generarLinkPago({
                email,
                name,
                monto,
                descripcion: `Plan ${planNombre}`
            });

            //const paymentLink = await acortarLink('https://www.google.com', {title: 'Codex Apps (Pagos)',
            //    description: 'Activa tu plan mensual ahora',
            //    image: 'https://img.freepik.com/foto-gratis/factura-telefono-3d-concepto-seguridad-pago-linea_107791-16722.jpg?semt=ais_hybrid&w=740'});
    //
            //
            const msg1 = `Hola *${name}*, para activar tu *Plan ${planNombre}*, realiza el pago aquí:\n🔗 ${paymentLink}`;
            const msg2 = `A continuación, te dejo los pasos para realizar el pago:

1. Da click en _"Transferencia vía Pago Efectivo"_.

2. ⚠️ Selecciona *BCP*.

3. Dale click en "*Pagar*".
__________________________
*Ahora realiza lo siguiente*

5. Abre tu billetera móvil (Yape, BCP, Interbank, etc.)\n busca la opción de *pagar servicios*.

6. Busca "*PagoEfectivo*" y coloca el código ⚠️ *sin espacios*.

7. ¡Dale click a pagar y listo! Enviame la cap del pago.

Si tienes algún problema, no dudes en decírmelo.
        `;
            await message.reply(msg1);
            setTimeout(() => client.sendMessage(message.from, msg2), 3000);

            // Guardar en memoria
            respuestasEnviadas.set(message.from, {
                app: appSolicitud,
                email,
                plan: planNombre,
                lastSent: now
            });

            planUser.set(email, {
                numero: message.from, // ← esto es clave
                app: appSolicitud,
                nombre: name,
                plan: planNombre,
                lastSent: now
            });


        }
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
