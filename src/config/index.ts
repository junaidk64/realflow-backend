import dotenv from 'dotenv';
dotenv.config();

const requireEnv = (key: string): string => {
  const val = process.env[key];
  if (!val && process.env.NODE_ENV === 'production') {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return val || '';
};

export const config = {
  port: parseInt(process.env.PORT || '5000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  mongoUri: process.env.MONGODB_URI || 'mongodb://localhost:27017/email-auto',
  jwt: {
    secret: process.env.JWT_SECRET || 'dev-jwt-secret-change-in-production',
    refreshSecret: process.env.JWT_REFRESH_SECRET || 'dev-refresh-secret-change-in-production',
    expiresIn: process.env.JWT_EXPIRES_IN || '15m',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  },
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    redirectUri: process.env.GOOGLE_REDIRECT_URI || 'http://localhost:5000/api/auth/google/callback',
    pubsubTopic: process.env.GOOGLE_PUBSUB_TOPIC || '',
  },
  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
  },
  n8n: {
    baseUrl: process.env.N8N_BASE_URL || 'https://n8n.boldme.site',
    apiKey: process.env.N8N_API_KEY || '',
    callbackSecret: process.env.N8N_CALLBACK_SECRET || '',
  },
  encryption: {
    key: process.env.ENCRYPTION_KEY || 'dev-encryption-key-32-chars-xxxx',
  },
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3000',
  resend: {
    apiKey: process.env.RESEND_API_KEY || '',
  },
  smtp: {
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
  },
  // WhatsApp — per-connection secrets are stored encrypted in WhatsAppConnection.
  // WHATSAPP_APP_SECRET is the fallback used when the webhook arrives before the
  // connection record can be loaded (e.g. the very first verification request).
  whatsapp: {
    graphApiVersion: process.env.WHATSAPP_GRAPH_API_VERSION || 'v21.0',
  },
};

export default config;
