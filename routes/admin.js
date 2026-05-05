const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const slugify = require('slugify');
const { getDb, getSetting, setSetting } = require('../config/database');
const { requireAuth, requireAdmin, redirectIfAuth } = require('../middleware/authentication/auth');
const { loginUser, changePassword, createUser } = require('../services/authService');

// Multer config for media uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = path.join(__dirname, '..', 'public', 'uploads');
    if (!fs.existsSync(uploadPath)) fs.mkdirSync(uploadPath, { recursive: true });
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e6);
    cb(null, unique + path.extname(file.originalname));
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp|svg|pdf|mp4|mp3|doc|docx|zip/;
    const ext = allowed.test(path.extname(file.originalname).toLowerCase());
    const mime = allowed.test(file.mimetype);
    cb(null, ext || mime);
  }
});

function makeSlug(title, db, table, excludeId = null) {
  let slug = slugify(title, { lower: true, strict: true, locale: 'es' });
  let check = db.prepare(`SELECT id FROM ${table} WHERE slug = ? ${excludeId ? 'AND id != ?' : ''}`);
  let existing = excludeId ? check.get(slug, excludeId) : check.get(slug);
  if (existing) slug = slug + '-' + Date.now();
  return slug;
}

// ─── AUTH ────────────────────────────────────────────────────────────────────

router.get('/login', redirectIfAuth, (req, res) => {
  res.render('admin/login', {
    error: req.flash('error'),
    success: req.flash('success'),
    siteTitle: getSetting('site_title') || 'MyCMS'
  });
});

router.post('/login', redirectIfAuth, async (req, res) => {
  const { username, password } = req.body;
  const user = await loginUser(username, password);
  if (!user) {
    req.flash('error', 'Usuario o contraseña incorrectos.');
    return res.redirect('/admin/login');
  }
  req.session.user = user;
  res.redirect('/admin/dashboard');
});

router.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/admin/login');
});

router.get('/', (req, res) => {
  res.redirect('/admin/dashboard');
});

// ─── DASHBOARD ───────────────────────────────────────────────────────────────

router.get('/dashboard', requireAuth, (req, res) => {
  const db = getDb();
  const stats = {
    posts: db.prepare('SELECT COUNT(*) as c FROM posts').get().c,
    published: db.prepare("SELECT COUNT(*) as c FROM posts WHERE status='published'").get().c,
    pages: db.prepare('SELECT COUNT(*) as c FROM pages').get().c,
    media: db.prepare('SELECT COUNT(*) as c FROM media').get().c,
    users: db.prepare('SELECT COUNT(*) as c FROM users').get().c
  };
  const recentPosts = db.prepare('SELECT p.*, u.username FROM posts p LEFT JOIN users u ON p.author_id = u.id ORDER BY p.created_at DESC LIMIT 5').all();
  res.render('admin/dashboard', { user: req.session.user, stats, recentPosts, siteTitle: getSetting('site_title'), flash: { error: req.flash('error'), success: req.flash('success') } });
});

// ─── POSTS ───────────────────────────────────────────────────────────────────

router.get('/posts', requireAuth, (req, res) => {
  const db = getDb();
  const page = parseInt(req.query.page) || 1;
  const perPage = 15;
  const offset = (page - 1) * perPage;
  const status = req.query.status || '';
  const search = req.query.search || '';

  let where = [];
  let params = [];
  if (status) { where.push("p.status = ?"); params.push(status); }
  if (search) { where.push("p.title LIKE ?"); params.push('%' + search + '%'); }
  const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';

  const total = db.prepare(`SELECT COUNT(*) as c FROM posts p ${whereClause}`).get(...params).c;
  const posts = db.prepare(`SELECT p.*, u.username FROM posts p LEFT JOIN users u ON p.author_id = u.id ${whereClause} ORDER BY p.created_at DESC LIMIT ? OFFSET ?`).all(...params, perPage, offset);

  res.render('admin/posts/index', {
    user: req.session.user, posts, total,
    page, perPage, pages: Math.ceil(total / perPage),
    status, search, siteTitle: getSetting('site_title'),
    flash: { error: req.flash('error'), success: req.flash('success') }
  });
});

router.get('/posts/new', requireAuth, (req, res) => {
  const db = getDb();
  const categories = db.prepare('SELECT * FROM categories ORDER BY name').all();
  res.render('admin/posts/edit', {
    user: req.session.user, post: null, categories,
    selectedCategories: [], siteTitle: getSetting('site_title'),
    flash: { error: req.flash('error'), success: req.flash('success') }
  });
});

router.get('/posts/:id/edit', requireAuth, (req, res) => {
  const db = getDb();
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
  if (!post) { req.flash('error', 'Entrada no encontrada.'); return res.redirect('/admin/posts'); }
  const categories = db.prepare('SELECT * FROM categories ORDER BY name').all();
  const selectedCategories = db.prepare('SELECT category_id FROM post_categories WHERE post_id = ?').all(post.id).map(r => r.category_id);
  res.render('admin/posts/edit', {
    user: req.session.user, post, categories, selectedCategories,
    siteTitle: getSetting('site_title'),
    flash: { error: req.flash('error'), success: req.flash('success') }
  });
});

router.post('/posts', requireAuth, upload.single('featured_image'), (req, res) => {
  const { title, content, excerpt, status, categories } = req.body;
  if (!title) { req.flash('error', 'El título es obligatorio.'); return res.redirect('/admin/posts/new'); }
  const db = getDb();
  const slug = makeSlug(title, db, 'posts');
  const featured_image = req.file ? '/uploads/' + req.file.filename : null;

  const result = db.prepare('INSERT INTO posts (title, slug, content, excerpt, featured_image, status, author_id) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    title, slug, content || '', excerpt || '', featured_image, status || 'draft', req.session.user.id
  );
  if (categories) {
    const cats = Array.isArray(categories) ? categories : [categories];
    cats.forEach(cId => db.prepare('INSERT OR IGNORE INTO post_categories (post_id, category_id) VALUES (?, ?)').run(result.lastInsertRowid, cId));
  }
  req.flash('success', 'Entrada creada correctamente.');
  res.redirect('/admin/posts');
});

router.post('/posts/:id', requireAuth, upload.single('featured_image'), (req, res) => {
  const { title, content, excerpt, status, categories } = req.body;
  const db = getDb();
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
  if (!post) { req.flash('error', 'Entrada no encontrada.'); return res.redirect('/admin/posts'); }
  if (!title) { req.flash('error', 'El título es obligatorio.'); return res.redirect('/admin/posts/' + req.params.id + '/edit'); }

  const slug = title !== post.title ? makeSlug(title, db, 'posts', post.id) : post.slug;
  let featured_image = post.featured_image;
  if (req.file) featured_image = '/uploads/' + req.file.filename;

  db.prepare('UPDATE posts SET title=?, slug=?, content=?, excerpt=?, featured_image=?, status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(
    title, slug, content || '', excerpt || '', featured_image, status || 'draft', post.id
  );
  db.prepare('DELETE FROM post_categories WHERE post_id = ?').run(post.id);
  if (categories) {
    const cats = Array.isArray(categories) ? categories : [categories];
    cats.forEach(cId => db.prepare('INSERT OR IGNORE INTO post_categories (post_id, category_id) VALUES (?, ?)').run(post.id, cId));
  }
  req.flash('success', 'Entrada actualizada correctamente.');
  res.redirect('/admin/posts');
});

router.post('/posts/:id/delete', requireAuth, (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM posts WHERE id = ?').run(req.params.id);
  req.flash('success', 'Entrada eliminada.');
  res.redirect('/admin/posts');
});

// ─── PAGES ───────────────────────────────────────────────────────────────────

router.get('/pages', requireAuth, (req, res) => {
  const db = getDb();
  const pages = db.prepare('SELECT p.*, u.username FROM pages p LEFT JOIN users u ON p.author_id = u.id ORDER BY p.created_at DESC').all();
  res.render('admin/pages/index', {
    user: req.session.user, pages, siteTitle: getSetting('site_title'),
    flash: { error: req.flash('error'), success: req.flash('success') }
  });
});

router.get('/pages/new', requireAuth, (req, res) => {
  res.render('admin/pages/edit', {
    user: req.session.user, page: null, siteTitle: getSetting('site_title'),
    flash: { error: req.flash('error'), success: req.flash('success') }
  });
});

router.get('/pages/:id/edit', requireAuth, (req, res) => {
  const db = getDb();
  const page = db.prepare('SELECT * FROM pages WHERE id = ?').get(req.params.id);
  if (!page) { req.flash('error', 'Página no encontrada.'); return res.redirect('/admin/pages'); }
  res.render('admin/pages/edit', {
    user: req.session.user, page, siteTitle: getSetting('site_title'),
    flash: { error: req.flash('error'), success: req.flash('success') }
  });
});

router.post('/pages', requireAuth, (req, res) => {
  const { title, content, status } = req.body;
  if (!title) { req.flash('error', 'El título es obligatorio.'); return res.redirect('/admin/pages/new'); }
  const db = getDb();
  const slug = makeSlug(title, db, 'pages');
  db.prepare('INSERT INTO pages (title, slug, content, status, author_id) VALUES (?, ?, ?, ?, ?)').run(
    title, slug, content || '', status || 'draft', req.session.user.id
  );
  req.flash('success', 'Página creada correctamente.');
  res.redirect('/admin/pages');
});

router.post('/pages/:id', requireAuth, (req, res) => {
  const { title, content, status } = req.body;
  const db = getDb();
  const page = db.prepare('SELECT * FROM pages WHERE id = ?').get(req.params.id);
  if (!page) { req.flash('error', 'Página no encontrada.'); return res.redirect('/admin/pages'); }
  const slug = title !== page.title ? makeSlug(title, db, 'pages', page.id) : page.slug;
  db.prepare('UPDATE pages SET title=?, slug=?, content=?, status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?').run(
    title, slug, content || '', status || 'draft', page.id
  );
  req.flash('success', 'Página actualizada correctamente.');
  res.redirect('/admin/pages');
});

router.post('/pages/:id/delete', requireAuth, (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM pages WHERE id = ?').run(req.params.id);
  req.flash('success', 'Página eliminada.');
  res.redirect('/admin/pages');
});

// ─── MEDIA ───────────────────────────────────────────────────────────────────

router.get('/media', requireAuth, (req, res) => {
  const db = getDb();
  const media = db.prepare('SELECT m.*, u.username FROM media m LEFT JOIN users u ON m.uploaded_by = u.id ORDER BY m.created_at DESC').all();
  res.render('admin/media', {
    user: req.session.user, media, siteTitle: getSetting('site_title'),
    flash: { error: req.flash('error'), success: req.flash('success') }
  });
});

router.post('/media/upload', requireAuth, upload.array('files', 20), (req, res) => {
  if (!req.files || req.files.length === 0) {
    req.flash('error', 'No se seleccionaron archivos.');
    return res.redirect('/admin/media');
  }
  const db = getDb();
  req.files.forEach(file => {
    db.prepare('INSERT INTO media (filename, original_name, mimetype, size, uploaded_by) VALUES (?, ?, ?, ?, ?)').run(
      file.filename, file.originalname, file.mimetype, file.size, req.session.user.id
    );
  });
  req.flash('success', `${req.files.length} archivo(s) subido(s) correctamente.`);
  res.redirect('/admin/media');
});

router.post('/media/:id/delete', requireAuth, (req, res) => {
  const db = getDb();
  const media = db.prepare('SELECT * FROM media WHERE id = ?').get(req.params.id);
  if (media) {
    const filePath = path.join(__dirname, '..', 'public', 'uploads', media.filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    db.prepare('DELETE FROM media WHERE id = ?').run(req.params.id);
  }
  req.flash('success', 'Archivo eliminado.');
  res.redirect('/admin/media');
});

// ─── CATEGORIES ──────────────────────────────────────────────────────────────

router.get('/categories', requireAuth, (req, res) => {
  const db = getDb();
  const categories = db.prepare('SELECT c.*, COUNT(pc.post_id) as post_count FROM categories c LEFT JOIN post_categories pc ON c.id = pc.category_id GROUP BY c.id ORDER BY c.name').all();
  res.render('admin/categories', {
    user: req.session.user, categories, siteTitle: getSetting('site_title'),
    flash: { error: req.flash('error'), success: req.flash('success') }
  });
});

router.post('/categories', requireAuth, (req, res) => {
  const { name } = req.body;
  if (!name) { req.flash('error', 'El nombre es obligatorio.'); return res.redirect('/admin/categories'); }
  const db = getDb();
  const slug = slugify(name, { lower: true, strict: true, locale: 'es' });
  try {
    db.prepare('INSERT INTO categories (name, slug) VALUES (?, ?)').run(name, slug);
    req.flash('success', 'Categoría creada.');
  } catch {
    req.flash('error', 'Ya existe una categoría con ese nombre.');
  }
  res.redirect('/admin/categories');
});

router.post('/categories/:id/delete', requireAuth, requireAdmin, (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM categories WHERE id = ?').run(req.params.id);
  req.flash('success', 'Categoría eliminada.');
  res.redirect('/admin/categories');
});

// ─── USERS ───────────────────────────────────────────────────────────────────

router.get('/users', requireAuth, requireAdmin, (req, res) => {
  const db = getDb();
  const users = db.prepare('SELECT id, username, email, role, created_at FROM users ORDER BY created_at DESC').all();
  res.render('admin/users', {
    user: req.session.user, users, siteTitle: getSetting('site_title'),
    flash: { error: req.flash('error'), success: req.flash('success') }
  });
});

router.post('/users', requireAuth, requireAdmin, async (req, res) => {
  const { username, email, password, role } = req.body;
  if (!username || !email || !password) { req.flash('error', 'Todos los campos son obligatorios.'); return res.redirect('/admin/users'); }
  const result = await createUser(username, email, password, role || 'editor');
  if (!result.ok) {
    req.flash('error', result.error);
  } else {
    req.flash('success', 'Usuario creado correctamente.');
  }
  res.redirect('/admin/users');
});

router.post('/users/:id/delete', requireAuth, requireAdmin, (req, res) => {
  if (parseInt(req.params.id) === req.session.user.id) {
    req.flash('error', 'No puedes eliminar tu propio usuario.');
    return res.redirect('/admin/users');
  }
  const db = getDb();
  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  req.flash('success', 'Usuario eliminado.');
  res.redirect('/admin/users');
});

// ─── SETTINGS ────────────────────────────────────────────────────────────────

router.get('/settings', requireAuth, requireAdmin, (req, res) => {
  res.render('admin/settings', {
    user: req.session.user,
    settings: {
      site_title: getSetting('site_title'),
      site_description: getSetting('site_description'),
      site_url: getSetting('site_url'),
      posts_per_page: getSetting('posts_per_page'),
      theme: getSetting('theme'),
      site_logo: getSetting('site_logo'),
      site_favicon: getSetting('site_favicon'),
      footer_text: getSetting('footer_text'),
      installed_at: getSetting('installed_at')
    },
    siteTitle: getSetting('site_title'),
    flash: { error: req.flash('error'), success: req.flash('success') }
  });
});

router.post('/settings', requireAuth, requireAdmin, (req, res) => {
  const { site_title, site_description, site_url, posts_per_page } = req.body;
  setSetting('site_title', site_title || 'MyCMS');
  setSetting('site_description', site_description || '');
  setSetting('site_url', site_url || '');
  setSetting('posts_per_page', posts_per_page || '10');
  req.flash('success', 'Ajustes guardados correctamente.');
  res.redirect('/admin/settings');
});

// ─── PROFILE ─────────────────────────────────────────────────────────────────

router.get('/profile', requireAuth, (req, res) => {
  const db = getDb();
  const user = db.prepare('SELECT id, username, email, role FROM users WHERE id = ?').get(req.session.user.id);
  res.render('admin/profile', {
    user: req.session.user, userData: user, siteTitle: getSetting('site_title'),
    flash: { error: req.flash('error'), success: req.flash('success') }
  });
});

router.post('/profile', requireAuth, async (req, res) => {
  const { email, current_password, new_password, new_password_confirm } = req.body;
  const db = getDb();

  if (new_password) {
    if (new_password !== new_password_confirm) {
      req.flash('error', 'Las nuevas contraseñas no coinciden.');
      return res.redirect('/admin/profile');
    }
    const result = await changePassword(req.session.user.id, current_password, new_password);
    if (!result.ok) {
      req.flash('error', result.error);
      return res.redirect('/admin/profile');
    }
    db.prepare('UPDATE users SET email=? WHERE id=?').run(email, req.session.user.id);
  } else {
    db.prepare('UPDATE users SET email=? WHERE id=?').run(email, req.session.user.id);
  }

  req.session.user.email = email;
  req.flash('success', 'Perfil actualizado correctamente.');
  res.redirect('/admin/profile');
});

// API for media picker
router.get('/api/media', requireAuth, (req, res) => {
  const db = getDb();
  const media = db.prepare("SELECT * FROM media WHERE mimetype LIKE 'image/%' ORDER BY created_at DESC LIMIT 50").all();
  res.json(media.map(m => ({ id: m.id, url: '/uploads/' + m.filename, name: m.original_name })));
});

module.exports = router;
