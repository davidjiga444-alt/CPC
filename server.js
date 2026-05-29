const express = require('express');
const session = require('express-session');
const flash = require('connect-flash');
const methodOverride = require('method-override');
const path = require('path');
const crypto = require('crypto');
const helmet = require('helmet');
const { initializeDatabase, isInstalled, getSetting } = require('./config/database');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── SECURITY HEADERS ────────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdn.jsdelivr.net"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdn.jsdelivr.net"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
    }
  }
}));

// ─── VIEW ENGINE ─────────────────────────────────────────────────────────────
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ─── MIDDLEWARE ───────────────────────────────────────────────────────────────
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(methodOverride('_method'));
app.use(express.static(path.join(__dirname, 'public')));

if (!process.env.SESSION_SECRET) {
  if (process.env.NODE_ENV === 'production') {
    console.error('FATAL: SESSION_SECRET env var no está configurado. Deteniéndose.');
    process.exit(1);
  }
  console.warn('⚠️  SESSION_SECRET no configurado. Usa una clave segura en producción (variable de entorno SESSION_SECRET).');
}

app.use(session({
  secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
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
    siteTitle: getSetting('site_title') || 'MyCMS',
    siteDescription: getSetting('site_description') || '',
    siteUrl: getSetting('site_url') || '',
    theme_color: getSetting('theme_color') || '#6366f1',
    theme_font: getSetting('theme_font') || 'DM Sans',
    theme_bg: getSetting('theme_bg') || '#ffffff',
    theme_text_color: getSetting('theme_text_color') || '#111827',
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
