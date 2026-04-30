const bcrypt = require('bcryptjs');
const { getDb } = require('../config/database');

/**
 * Intenta autenticar a un usuario con username/email y contraseña.
 * @returns {object|null} El usuario si las credenciales son válidas, null si no.
 */
async function loginUser(usernameOrEmail, password) {
  const db = getDb();

  // Buscar por username O email
  const user = db
    .prepare('SELECT * FROM users WHERE username = ? OR email = ?')
    .get(usernameOrEmail, usernameOrEmail);

  if (!user) return null;

  const passwordMatch = await bcrypt.compare(password, user.password);
  if (!passwordMatch) return null;

  // Devolver solo los datos necesarios (nunca el hash)
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role
  };
}

/**
 * Cambia la contraseña de un usuario verificando la contraseña actual.
 * @returns {{ ok: boolean, error?: string }}
 */
async function changePassword(userId, currentPassword, newPassword) {
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);

  if (!user) return { ok: false, error: 'Usuario no encontrado.' };

  const match = await bcrypt.compare(currentPassword, user.password);
  if (!match) return { ok: false, error: 'La contraseña actual es incorrecta.' };

  const hashed = await bcrypt.hash(newPassword, 12);
  db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hashed, userId);

  return { ok: true };
}

/**
 * Crea un nuevo usuario con la contraseña hasheada.
 * @returns {{ ok: boolean, error?: string }}
 */
async function createUser(username, email, password, role = 'editor') {
  const db = getDb();
  const hashed = await bcrypt.hash(password, 12);

  try {
    db.prepare('INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, ?)')
      .run(username, email, hashed, role);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: 'El nombre de usuario o email ya existe.' };
  }
}

module.exports = { loginUser, changePassword, createUser };
