const { nanoid } = require('nanoid');
// firebase.js
// firebase.js
const { setDoc, doc, collection } = require("firebase/firestore/lite");
const {db2} = require('./db/firebase')

const db = db2


// 🗂️ Simulación de base de datos en memoria
async function acortarLink(originalUrl, opciones = {}) {
    if (!originalUrl || !originalUrl.startsWith('http')) {
        throw new Error('❌ URL inválida.');
    }

    const id = nanoid(6);

    const linkData = {
        originalUrl,
        title: opciones.title || 'Enlace personalizado',
        description: opciones.description || 'Haz clic para ver más detalles.',
        image: opciones.image || 'https://img.freepik.com/foto-gratis/factura-telefono-3d-concepto-seguridad-pago-linea_107791-16722.jpg?semt=ais_hybrid&w=740',
        creado: new Date()
    };

    await setDoc(doc(collection(db, 'links'), id), linkData);

    return `https://perfil-ldpa.onrender.com/${id}`;
}

// 📌 Ruta para acortar vía POST
//app.post('/acortar', (req, res) => {
//    const { url } = req.body;
//
//    if (!url) {
//        return res.status(400).json({ error: 'URL requerida' });
//    }
//
//    const shortUrl = acortarLink(url);
//    res.json({ shortUrl });
//});
//
//// 🔁 Ruta para redirigir
//app.get('/:id', (req, res) => {
//    const id = req.params.id;
//    const originalUrl = links.get(id);
//
//    if (originalUrl) {
//        res.redirect(originalUrl);
//    } else {
//        res.status(404).send('❌ Enlace no encontrado');
//    }
//});

// 🚀 Iniciar servidor


// 🧪 Simulación de uso real
async function generarLinkDePagoSimulado() {
    const paymentLink = 'https://www.mercadopago.com.pe/checkout/v1/redirect?pref_id=123456789';
    const shortLink = acortarLink(paymentLink);

    console.log('🔗 Link de pago:', paymentLink);
    console.log('🔗 Link acortado:', shortLink);
}

// Ejecutar ejemplo (simulado)
//generarLinkDePagoSimulado();

module.exports = { acortarLink };

