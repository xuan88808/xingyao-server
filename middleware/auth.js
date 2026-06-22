import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'xingyao-admin-secret-change-in-production';
const JWT_EXPIRES = process.env.JWT_EXPIRES || '24h';

// 生成 token
export function generateToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}

// 验证 token 中间件
export function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: '未提供认证令牌' });
  }

  const token = header.slice(7);
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.admin = decoded;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: '令牌已过期，请重新登录' });
    }
    return res.status(401).json({ error: '无效的认证令牌' });
  }
}

// 角色权限中间件
export function roleMiddleware(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.admin.role)) {
      return res.status(403).json({ error: '权限不足' });
    }
    next();
  };
}
