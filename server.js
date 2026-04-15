const express = require('express');
const nodemailer = require('nodemailer');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Rate limiting simple (máx 5 formularios por IP cada 15 min)
const submissionMap = new Map();
function rateLimit(ip) {
  const now = Date.now();
  const window = 15 * 60 * 1000; // 15 minutos
  const max = 5;
  const record = submissionMap.get(ip) || { count: 0, start: now };
  if (now - record.start > window) {
    submissionMap.set(ip, { count: 1, start: now });
    return false;
  }
  if (record.count >= max) return true; // bloqueado
  record.count++;
  submissionMap.set(ip, record);
  return false;
}

// Configuración de Nodemailer
function createTransporter() {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS, // App Password de Gmail
    },
  });
}

// Sanitizar texto
function sanitize(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]));
}

// POST /api/contact
app.post('/api/contact', async (req, res) => {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
  if (rateLimit(ip)) {
    return res.status(429).json({ error: 'Demasiadas solicitudes. Inténtelo más tarde.' });
  }

  const { nombre, email, telefono, asunto, mensaje } = req.body;

  // Validación básica
  if (!nombre || !email || !asunto || !mensaje) {
    return res.status(400).json({ error: 'Faltan campos obligatorios.' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Email no válido.' });
  }
  if (nombre.length > 100 || asunto.length > 200 || mensaje.length > 2000) {
    return res.status(400).json({ error: 'Los campos exceden el tamaño permitido.' });
  }

  const sNombre = sanitize(nombre);
  const sEmail = sanitize(email);
  const sTelefono = sanitize(telefono || 'No indicado');
  const sAsunto = sanitize(asunto);
  const sMensaje = sanitize(mensaje);

  const htmlBody = `
    <div style="font-family: 'Manrope', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #fcf9f4; border: 1px solid #e5e2dd;">
      <div style="background: #021a35; padding: 32px 40px;">
        <h1 style="color: #ffffff; font-family: Georgia, serif; font-size: 22px; margin: 0;">Nueva consulta desde la web</h1>
        <p style="color: #b3c8eb; font-size: 12px; margin: 8px 0 0; text-transform: uppercase; letter-spacing: 0.2em;">José Gil · Procurador en Pontevedra</p>
      </div>
      <div style="padding: 40px;">
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="padding: 12px 0; border-bottom: 1px solid #e5e2dd; color: #44474d; font-size: 11px; text-transform: uppercase; letter-spacing: 0.15em; width: 30%;">Nombre</td>
            <td style="padding: 12px 0; border-bottom: 1px solid #e5e2dd; color: #1c1c19; font-weight: 600;">${sNombre}</td>
          </tr>
          <tr>
            <td style="padding: 12px 0; border-bottom: 1px solid #e5e2dd; color: #44474d; font-size: 11px; text-transform: uppercase; letter-spacing: 0.15em;">Email</td>
            <td style="padding: 12px 0; border-bottom: 1px solid #e5e2dd; color: #1c1c19; font-weight: 600;">
              <a href="mailto:${sEmail}" style="color: #875044; text-decoration: none;">${sEmail}</a>
            </td>
          </tr>
          <tr>
            <td style="padding: 12px 0; border-bottom: 1px solid #e5e2dd; color: #44474d; font-size: 11px; text-transform: uppercase; letter-spacing: 0.15em;">Teléfono</td>
            <td style="padding: 12px 0; border-bottom: 1px solid #e5e2dd; color: #1c1c19; font-weight: 600;">${sTelefono}</td>
          </tr>
          <tr>
            <td style="padding: 12px 0; border-bottom: 1px solid #e5e2dd; color: #44474d; font-size: 11px; text-transform: uppercase; letter-spacing: 0.15em;">Asunto</td>
            <td style="padding: 12px 0; border-bottom: 1px solid #e5e2dd; color: #1c1c19; font-weight: 600;">${sAsunto}</td>
          </tr>
        </table>
        <div style="margin-top: 24px;">
          <p style="color: #44474d; font-size: 11px; text-transform: uppercase; letter-spacing: 0.15em; margin-bottom: 12px;">Mensaje</p>
          <div style="background: #f0ede9; border-left: 3px solid #875044; padding: 20px; color: #1c1c19; line-height: 1.7; white-space: pre-wrap;">${sMensaje}</div>
        </div>
      </div>
      <div style="background: #f0ede9; padding: 20px 40px; text-align: center; border-top: 1px solid #e5e2dd;">
        <p style="color: #44474d; font-size: 11px; margin: 0;">Recibido el ${new Date().toLocaleDateString('es-ES', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
      </div>
    </div>
  `;

  try {
    const transporter = createTransporter();
    await transporter.sendMail({
      from: `"Web José Gil" <${process.env.SMTP_USER}>`,
      to: process.env.RECIPIENT_EMAIL || 'jmgilprocurador@gmail.com',
      replyTo: email,
      subject: `[Web] Consulta: ${sAsunto} — ${sNombre}`,
      html: htmlBody,
    });

    console.log(`[${new Date().toISOString()}] Consulta enviada de: ${email}`);
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error(`[${new Date().toISOString()}] Error al enviar email:`, err.message);
    return res.status(500).json({ error: 'Error interno al enviar el mensaje.' });
  }
});

// Ruta catch-all → index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Servidor iniciado en http://localhost:${PORT}`);
});
