const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { initializeDatabase, isInstalled, setSetting, getDb } = require('../config/database');

router.get('/', (req, res) => {
  if (isInstalled()) return res.redirect('/admin/dashboard');
  res.render('setup/index', { error: null, step: 1 });
});

router.post('/', async (req, res) => {
  if (isInstalled()) return res.redirect('/admin/dashboard');

  const { site_title, site_description, site_url, admin_username, admin_email, admin_password, admin_password_confirm } = req.body;

  // Validations
  if (!site_title || !admin_username || !admin_email || !admin_password) {
    return res.render('setup/index', { error: 'Todos los campos son obligatorios.', step: 1, body: req.body });
  }
  if (admin_password !== admin_password_confirm) {
    return res.render('setup/index', { error: 'Las contraseñas no coinciden.', step: 1, body: req.body });
  }
  if (admin_password.length < 8) {
    return res.render('setup/index', { error: 'La contraseña debe tener al menos 8 caracteres.', step: 1, body: req.body });
  }

  try {
    initializeDatabase();
    const db = getDb();

    // Hash password
    const hashedPassword = await bcrypt.hash(admin_password, 12);

    // Create admin user
    db.prepare('INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, ?)').run(
      admin_username, admin_email, hashedPassword, 'admin'
    );

    // Save settings
    setSetting('site_title', site_title);
    setSetting('site_description', site_description || '');
    setSetting('site_url', site_url || '');
    setSetting('installed', 'true');
    setSetting('installed_at', new Date().toISOString());
    setSetting('posts_per_page', '10');
    setSetting('theme', 'default');

    // Create default category
    db.prepare('INSERT INTO categories (name, slug) VALUES (?, ?)').run('Sin categoría', 'sin-categoria');

    // Create welcome post
    const adminUser = db.prepare('SELECT id FROM users WHERE email = ?').get(admin_email);
    db.prepare(`INSERT INTO posts (title, slug, content, excerpt, status, author_id) VALUES (?, ?, ?, ?, ?, ?)`).run(
      '¡Bienvenido a MyCMS!',
      'bienvenido-a-mycms',
      '<h2>¡Hola mundo!</h2><p>Esta es tu primera entrada. Puedes editarla o borrarla y empezar a escribir tu propio contenido.</p><p>Accede al <a href="/admin">panel de administración</a> para gestionar tu sitio web.</p>',
      'Esta es tu primera entrada. Puedes editarla o borrarla.',
      'published',
      adminUser.id
    );

    // Create default page
    db.prepare(`INSERT INTO pages (title, slug, content, status, author_id) VALUES (?, ?, ?, ?, ?)`).run(
      'Acerca de',
      'acerca-de',
      '<h2>Sobre este sitio</h2><p>Esta es una página de ejemplo. Edítala para contar a tus visitantes sobre tu sitio web.</p>',
      'published',
      adminUser.id
    );

    req.flash('success', '¡Instalación completada! Ya puedes acceder al panel de administración.');
    res.redirect('/admin/login');
  } catch (err) {
    console.error(err);
    res.render('setup/index', { error: 'Error durante la instalación: ' + err.message, step: 1, body: req.body });
  }
});

module.exports = router;
