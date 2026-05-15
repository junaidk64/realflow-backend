import { OAuth2Client } from 'google-auth-library';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { User, IUser } from '../models/User';
import { Settings } from '../models/Settings';
import logger from '../utils/logger';

const oauth2Client = new OAuth2Client(
  config.google.clientId,
  config.google.clientSecret,
  config.google.redirectUri
);

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: string;
}

export interface GoogleTokens {
  accessToken: string;
  refreshToken: string;
  expiryDate: number;
}

export interface AuthResult {
  user: IUser;
  tokens: TokenPair;
  googleTokens: GoogleTokens;
  isNewUser: boolean;
}

export const generateAuthUrl = (state?: string): string => {
  const scopes = [
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/gmail.modify',
  ];

  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
    prompt: 'consent',
    state: state || '',
    include_granted_scopes: true,
  });
};

export const handleCallback = async (code: string): Promise<AuthResult> => {
  const { tokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);

  const ticket = await oauth2Client.verifyIdToken({
    idToken: tokens.id_token!,
    audience: config.google.clientId,
  });

  const payload = ticket.getPayload();
  if (!payload) throw new Error('Invalid Google token payload');

  const { sub: googleId, email, name, picture } = payload;
  if (!email) throw new Error('No email in Google profile');

  let user = await User.findOne({ googleId });
  let isNewUser = false;

  if (!user) {
    user = await User.findOne({ email });
    if (user) {
      user.googleId = googleId!;
      user.avatar = picture;
      await user.save();
    } else {
      user = await User.create({
        googleId,
        email,
        name: name || email.split('@')[0],
        avatar: picture,
        role: 'user',
      });
      isNewUser = true;

      // Create default settings for new user
      await Settings.create({ userId: user._id });
    }
  }

  user.lastLogin = new Date();
  await user.save();

  const tokenPair = generateTokenPair(user);

  logger.info(`User authenticated: ${email}, isNew: ${isNewUser}`);

  return {
    user,
    tokens: tokenPair,
    googleTokens: {
      accessToken: tokens.access_token!,
      refreshToken: tokens.refresh_token!,
      expiryDate: tokens.expiry_date || Date.now() + 3600000,
    },
    isNewUser,
  };
};

export const generateTokenPair = (user: IUser): TokenPair => {
  const payload = {
    userId: (user._id as string).toString(),
    email: user.email,
    role: user.role,
  };

  const accessToken = jwt.sign(payload, config.jwt.secret, {
    expiresIn: config.jwt.expiresIn as string,
  } as jwt.SignOptions);

  const refreshToken = jwt.sign(payload, config.jwt.refreshSecret, {
    expiresIn: config.jwt.refreshExpiresIn as string,
  } as jwt.SignOptions);

  return { accessToken, refreshToken, expiresIn: config.jwt.expiresIn };
};

export const refreshAccessToken = async (refreshToken: string): Promise<TokenPair> => {
  try {
    const decoded = jwt.verify(refreshToken, config.jwt.refreshSecret) as {
      userId: string;
      email: string;
      role: string;
    };

    const user = await User.findById(decoded.userId);
    if (!user || !user.isActive) {
      throw new Error('User not found or inactive');
    }

    return generateTokenPair(user);
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw new Error('Refresh token expired');
    }
    throw error;
  }
};

export const getOAuth2Client = (): OAuth2Client => oauth2Client;

export default {
  generateAuthUrl,
  handleCallback,
  generateTokenPair,
  refreshAccessToken,
  getOAuth2Client,
};
