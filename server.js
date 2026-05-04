const express = require('express');
const session = require('express-session');
const flash = require('connect-flash');
const methodOverride = require('method-override');
const path = require('path');
const { initializeDatabase, isInstalled } = require('./config/database');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── VIEW ENGINE ─────────────────────────────────────────────────────────────
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ─── MIDDLEWARE ───────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(methodOverride('_method'));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: process.env.SESSION_SECRET || 'mycms-secret-change-in-production-' + Math.random(),
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false,
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

app.use(flash());

// ─── INIT DATABASE ────────────────────────────────────────────────────────────
try {
  initializeDatabase();
  console.log('✅ Base de datos inicializada');
} catch (err) {
  console.error('❌ Error al inicializar la base de datos:', err.message);
  process.exit(1);
}

// ─── SETUP GUARD ─────────────────────────────────────────────────────────────
app.use((req, res, next) => {
  const publicPaths = ['/setup', '/admin/login', '/admin/logout'];
  const isSetupRoute = req.path.startsWith('/setup');
  const isAdminAuth = req.path === '/admin/login' || req.path === '/admin/logout';
  const isPublicAsset = req.path.startsWith('/uploads') || req.path.startsWith('/css') || req.path.startsWith('/js');

  if (!isInstalled() && !isSetupRoute && !isPublicAsset) {
    return res.redirect('/setup');
  }
  next();
});

// ─── ROUTES ───────────────────────────────────────────────────────────────────
app.use('/setup', require('./routes/setup'));
app.use('/admin', require('./routes/admin'));
app.use('/', require('./routes/public'));

// ─── 404 & ERROR HANDLING ─────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).render('theme/404', {
    siteTitle: 'Página no encontrada',
    siteDescription: '',
    siteUrl: '',
    navPages: []
  });
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send('<h1>Error interno del servidor</h1><p>' + (process.env.NODE_ENV === 'development' ? err.message : 'Algo salió mal.') + '</p>');
});

// ─── START ────────────────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`
╔═══════════════════════════════════════╗
║           MyCMS está corriendo        ║
╠═══════════════════════════════════════╣
║  URL: http://localhost:${PORT}           ║
║  Admin: http://localhost:${PORT}/admin   ║
╚═══════════════════════════════════════╝
  `);
  if (!isInstalled()) {
    console.log('⚠️  Primera vez: Accede a http://localhost:' + PORT + '/setup para instalar el CMS');
  }
});

module.exports = app;
