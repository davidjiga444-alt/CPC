const { getDb } = require('../../config/database');

/**
 * Verifica que el usuario está autenticado.
 * Además comprueba que el usuario sigue existiendo en la base de datos.
 */
async function requireAuth(req, res, next) {
  if (!req.session || !req.session.user) {
    req.flash('error', 'Debes iniciar sesión para acceder al panel de administración.');
    return res.redirect('/admin/login');
  }

  try {
    // Verificar que el usuario todavía existe en la BD
    const db = getDb();
    const user = db.prepare('SELECT id, username, email, role FROM users WHERE id = ?').get(req.session.user.id);

    if (!user) {
      // El usuario fue eliminado, destruir sesión
      req.session.destroy();
      req.flash('error', 'Tu cuenta ya no existe. Contacta con el administrador.');
      return res.redirect('/admin/login');
    }

    // Actualizar datos de sesión por si cambiaron
    req.session.user = { id: user.id, username: user.username, email: user.email, role: user.role };
    return next();
  } catch (err) {
    console.error('Error en requireAuth:', err.message);
    return res.redirect('/admin/login');
  }
}

/**
 * Verifica que el usuario autenticado tiene rol de administrador.
 * Siempre usar DESPUÉS de requireAuth.
 */
function requireAdmin(req, res, next) {
  if (req.session && req.session.user && req.session.user.role === 'admin') {
    return next();
  }
  req.flash('error', 'No tienes permisos para realizar esta acción.');
  return res.redirect('/admin/dashboard');
}

/**
 * Redirige al dashboard si el usuario ya está autenticado.
 * Usar en las rutas de login para evitar doble acceso.
 */
function redirectIfAuth(req, res, next) {
  if (req.session && req.session.user) {
    return res.redirect('/admin/dashboard');
  }
  return next();
}

module.exports = { requireAuth, requireAdmin, redirectIfAuth };
