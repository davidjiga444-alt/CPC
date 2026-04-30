const express = require('express');
const router = express.Router();
const { getDb, getSetting } = require('../config/database');

function getSiteData() {
  return {
    siteTitle: getSetting('site_title') || 'MyCMS',
    siteDescription: getSetting('site_description') || '',
    siteUrl: getSetting('site_url') || ''
  };
}

function getPublishedPages(db) {
  return db.prepare("SELECT title, slug FROM pages WHERE status='published' ORDER BY title").all();
}

// Home - list of posts
router.get('/', (req, res) => {
  const db = getDb();
  const perPage = parseInt(getSetting('posts_per_page')) || 10;
  const page = parseInt(req.query.page) || 1;
  const offset = (page - 1) * perPage;
  const category = req.query.category || '';

  let posts, total;
  if (category) {
    const cat = db.prepare('SELECT * FROM categories WHERE slug = ?').get(category);
    if (!cat) return res.redirect('/');
    total = db.prepare("SELECT COUNT(*) as c FROM posts p JOIN post_categories pc ON p.id = pc.post_id WHERE pc.category_id = ? AND p.status='published'").get(cat.id).c;
    posts = db.prepare("SELECT p.*, u.username FROM posts p JOIN post_categories pc ON p.id = pc.post_id LEFT JOIN users u ON p.author_id = u.id WHERE pc.category_id = ? AND p.status='published' ORDER BY p.created_at DESC LIMIT ? OFFSET ?").all(cat.id, perPage, offset);
    return res.render('theme/index', {
      ...getSiteData(), posts, page, pages: Math.ceil(total / perPage),
      navPages: getPublishedPages(db), category: cat, categories: getCategories(db)
    });
  }

  total = db.prepare("SELECT COUNT(*) as c FROM posts WHERE status='published'").get().c;
  posts = db.prepare("SELECT p.*, u.username FROM posts p LEFT JOIN users u ON p.author_id = u.id WHERE p.status='published' ORDER BY p.created_at DESC LIMIT ? OFFSET ?").all(perPage, offset);

  res.render('theme/index', {
    ...getSiteData(), posts, page, pages: Math.ceil(total / perPage),
    navPages: getPublishedPages(db), category: null, categories: getCategories(db)
  });
});

function getCategories(db) {
  return db.prepare('SELECT c.*, COUNT(pc.post_id) as count FROM categories c LEFT JOIN post_categories pc ON c.id = pc.category_id LEFT JOIN posts p ON pc.post_id = p.id AND p.status = \'published\' GROUP BY c.id HAVING count > 0').all();
}

// Single post
router.get('/post/:slug', (req, res) => {
  const db = getDb();
  const post = db.prepare("SELECT p.*, u.username FROM posts p LEFT JOIN users u ON p.author_id = u.id WHERE p.slug = ? AND p.status='published'").get(req.params.slug);
  if (!post) return res.status(404).render('theme/404', { ...getSiteData(), navPages: getPublishedPages(db) });

  const categories = db.prepare('SELECT c.* FROM categories c JOIN post_categories pc ON c.id = pc.category_id WHERE pc.post_id = ?').all(post.id);
  const related = db.prepare("SELECT * FROM posts WHERE status='published' AND id != ? ORDER BY created_at DESC LIMIT 3").all(post.id);

  res.render('theme/post', {
    ...getSiteData(), post, categories, related,
    navPages: getPublishedPages(db)
  });
});

// Single page
router.get('/page/:slug', (req, res) => {
  const db = getDb();
  const page = db.prepare("SELECT p.*, u.username FROM pages p LEFT JOIN users u ON p.author_id = u.id WHERE p.slug = ? AND p.status='published'").get(req.params.slug);
  if (!page) return res.status(404).render('theme/404', { ...getSiteData(), navPages: getPublishedPages(db) });

  res.render('theme/page', {
    ...getSiteData(), page, navPages: getPublishedPages(db)
  });
});

// Search
router.get('/buscar', (req, res) => {
  const db = getDb();
  const q = req.query.q || '';
  const posts = q ? db.prepare("SELECT p.*, u.username FROM posts p LEFT JOIN users u ON p.author_id = u.id WHERE p.status='published' AND (p.title LIKE ? OR p.content LIKE ?) ORDER BY p.created_at DESC").all('%'+q+'%', '%'+q+'%') : [];
  res.render('theme/search', {
    ...getSiteData(), posts, q, navPages: getPublishedPages(db)
  });
});

module.exports = router;
