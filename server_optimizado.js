const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const PDFDocument = require('pdfkit');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5000;

// Configuración de PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

app.use(cors());
app.use(express.json());
app.use(express.static('public')); // Archivos estáticos

// ==================== FUNCIONES AUXILIARES ====================

async function generarTicket() {
  const result = await pool.query('SELECT COUNT(*) as total FROM turnos');
  const total = parseInt(result.rows[0].total);
  return `T-${String(total + 1).padStart(4, '0')}`;
}

// ==================== ENDPOINTS API ====================

// Raíz - Información de la API
app.get('/', (req, res) => {
  res.json({
    mensaje: '🎫 Sistema de Turnos ManyChat - API Activa',
    version: '3.0.0',
    database: 'PostgreSQL',
    endpoints: {
      'GET /': 'Información de la API',
      'GET /panel': 'Panel web de administración',
      'POST /turno': 'Crear turno (body: id_usuario, nombre, solicitud)',
      'GET /turnos': 'Lista completa de turnos',
      'GET /turno/:id/pdf': 'Descargar PDF del turno',
      'PUT /turno/:id': 'Actualizar turno',
      'DELETE /turno/:id': 'Eliminar turno'
    },
    estado: 'activo',
    puerto: PORT
  });
});

// Panel web - Servir HTML
app.get('/panel', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'panel.html'));
});

// Crear o consultar turno
app.post('/turno', async (req, res) => {
  try {
    const { id_usuario, nombre, solicitud } = req.body;

    if (!id_usuario || !nombre || !solicitud) {
      return res.status(400).json({
        error: 'Faltan datos requeridos: id_usuario, nombre y solicitud son obligatorios'
      });
    }

    // Verificar si ya existe
    const existente = await pool.query(
      'SELECT * FROM turnos WHERE id_usuario = $1',
      [id_usuario]
    );
    
    if (existente.rows.length > 0) {
      const turno = existente.rows[0];
      return res.json({
        ticket: turno.ticket,
        nombre: turno.nombre,
        solicitud: turno.solicitud,
        fecha: turno.fecha,
        mensaje: `Ya tienes un turno asignado: ${turno.ticket}`,
        pdf_url: `${req.protocol}://${req.get('host')}/turno/${turno.id}/pdf`
      });
    }

    // Crear nuevo turno
    const nuevoTicket = await generarTicket();
    const result = await pool.query(
      'INSERT INTO turnos (id_usuario, nombre, solicitud, ticket, fecha) VALUES ($1, $2, $3, $4, NOW()) RETURNING *',
      [id_usuario, nombre, solicitud, nuevoTicket]
    );

    const turno = result.rows[0];

    res.json({
      ticket: turno.ticket,
      nombre: turno.nombre,
      solicitud: turno.solicitud,
      fecha: turno.fecha,
      mensaje: `Turno asignado correctamente a ${nombre}`,
      pdf_url: `${req.protocol}://${req.get('host')}/turno/${turno.id}/pdf`
    });

  } catch (error) {
    console.error('Error en POST /turno:', error);
    res.status(500).json({
      error: 'Error al procesar el turno'
    });
  }
});

// Obtener todos los turnos
app.get('/turnos', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM turnos ORDER BY id DESC');
    res.json(result.rows);
  } catch (error) {
    console.error('Error en GET /turnos:', error);
    res.status(500).json({ error: 'Error al obtener turnos' });
  }
});

// Generar PDF de turno
app.get('/turno/:id/pdf', async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await pool.query('SELECT * FROM turnos WHERE id = $1', [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Turno no encontrado' });
    }

    const turno = result.rows[0];
    const fecha = new Date(turno.fecha);
    const fechaFormateada = fecha.toLocaleDateString('es-ES', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });

    // Crear PDF
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=turno-${turno.ticket}.pdf`);
    
    doc.pipe(res);

    // Encabezado
    doc.fontSize(28).fillColor('#667eea').text('🎫 COMPROBANTE DE TURNO', { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(12).fillColor('#666').text('Sistema de Turnos ManyChat', { align: 'center' });
    doc.moveDown(2);

    // Línea decorativa
    doc.strokeColor('#667eea').lineWidth(3).moveTo(50, doc.y).lineTo(545, doc.y).stroke();
    doc.moveDown(1.5);

    // Número de ticket (destacado)
    doc.fontSize(20).fillColor('#667eea').text(`Ticket: ${turno.ticket}`, { align: 'center' });
    doc.moveDown(2);

    // Información del turno
    doc.fontSize(14).fillColor('#333');
    
    doc.font('Helvetica-Bold').text('Nombre:', { continued: true });
    doc.font('Helvetica').text(` ${turno.nombre}`);
    doc.moveDown(0.5);

    doc.font('Helvetica-Bold').text('ID Usuario:', { continued: true });
    doc.font('Helvetica').text(` ${turno.id_usuario}`);
    doc.moveDown(0.5);

    doc.font('Helvetica-Bold').text('Fecha y Hora:', { continued: true });
    doc.font('Helvetica').text(` ${fechaFormateada}`);
    doc.moveDown(1);

    // Solicitud
    doc.font('Helvetica-Bold').text('Solicitud:');
    doc.moveDown(0.3);
    doc.font('Helvetica').fontSize(12).text(turno.solicitud, {
      align: 'justify',
      lineGap: 3
    });
    doc.moveDown(2);

    // Línea decorativa inferior
    doc.strokeColor('#667eea').lineWidth(2).moveTo(50, doc.y).lineTo(545, doc.y).stroke();
    doc.moveDown(1);

    // Pie de página
    doc.fontSize(10).fillColor('#999').text(
      'Este documento es un comprobante de turno. Guárdelo para futuras referencias.',
      { align: 'center' }
    );
    doc.moveDown(0.5);
    doc.fontSize(8).text(
      `Generado el ${new Date().toLocaleString('es-ES')}`,
      { align: 'center' }
    );

    doc.end();

  } catch (error) {
    console.error('Error al generar PDF:', error);
    res.status(500).json({ error: 'Error al generar PDF' });
  }
});

// Actualizar turno
app.put('/turno/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { nombre, solicitud } = req.body;

    if (!nombre || !solicitud) {
      return res.status(400).json({
        error: 'Faltan datos: nombre y solicitud son obligatorios'
      });
    }

    const result = await pool.query(
      'UPDATE turnos SET nombre = $1, solicitud = $2 WHERE id = $3 RETURNING *',
      [nombre, solicitud, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Turno no encontrado' });
    }

    res.json({
      mensaje: 'Turno actualizado correctamente',
      turno: result.rows[0]
    });

  } catch (error) {
    console.error('Error en PUT /turno:', error);
    res.status(500).json({ error: 'Error al actualizar turno' });
  }
});

// Eliminar turno
app.delete('/turno/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      'DELETE FROM turnos WHERE id = $1 RETURNING *',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Turno no encontrado' });
    }

    res.json({
      mensaje: 'Turno eliminado correctamente',
      turno: result.rows[0]
    });

  } catch (error) {
    console.error('Error en DELETE /turno:', error);
    res.status(500).json({ error: 'Error al eliminar turno' });
  }
});

// ==================== INICIALIZACIÓN ====================

async function initDatabase() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS turnos (
        id SERIAL PRIMARY KEY,
        id_usuario VARCHAR(255) UNIQUE NOT NULL,
        nombre VARCHAR(255) NOT NULL,
        solicitud TEXT NOT NULL,
        ticket VARCHAR(50) NOT NULL,
        fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ Base de datos inicializada');
  } catch (error) {
    console.error('❌ Error al inicializar BD:', error);
  }
}

// Iniciar servidor
initDatabase().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🚀 Servidor activo en puerto ${PORT}`);
    console.log(`📊 Panel: http://localhost:${PORT}/panel`);
    console.log(`🎫 API: http://localhost:${PORT}\n`);
  });
});

module.exports = app;