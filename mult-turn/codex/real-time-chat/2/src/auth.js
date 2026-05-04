import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';

export function signAuthToken(user) {
  return jwt.sign(
    {
      userId: user.userId,
      username: user.username
    },
    JWT_SECRET
  );
}

export function verifyAuthToken(token) {
  const decoded = jwt.verify(token, JWT_SECRET);

  return {
    userId: decoded.userId,
    username: decoded.username
  };
}

export function authenticateToken(req, res, next) {
  const authorization = req.get('authorization');

  if (!authorization?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const token = authorization.slice('Bearer '.length).trim();

  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    req.user = verifyAuthToken(token);
    return next();
  } catch (error) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
}
