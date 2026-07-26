import request from 'supertest';
import { app } from '../app';
import { verifyPasswordResetToken } from '../utils/jwt';

jest.mock('../config/database', () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    passwordResetRequest: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn(),
    $connect: jest.fn(),
    $disconnect: jest.fn(),
  },
}));

jest.mock('../services/hubtel.service', () => ({
  sendOtp: jest.fn(),
  verifyOtp: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { prisma } = require('../config/database') as {
  prisma: {
    user: { findUnique: jest.Mock; update: jest.Mock };
    passwordResetRequest: { create: jest.Mock; findUnique: jest.Mock; update: jest.Mock };
    $transaction: jest.Mock;
  };
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { sendOtp, verifyOtp } = require('../services/hubtel.service') as {
  sendOtp: jest.Mock;
  verifyOtp: jest.Mock;
};

const PHONE = '+233244123456';
const USER = { id: 'user-1', isActive: true };

const RESET_REQUEST = {
  id: 'reset-req-1',
  userId: USER.id,
  phone: PHONE,
  requestId: 'hubtel-req-1',
  prefix: '12',
  verified: false,
  consumed: false,
  expiresAt: new Date(Date.now() + 10 * 60 * 1000),
  createdAt: new Date(),
};

beforeEach(() => {
  jest.clearAllMocks();
});

// ── POST /api/v1/auth/forgot-password/sms ────────────────────────────────────
describe('POST /api/v1/auth/forgot-password/sms', () => {
  it('returns 422 for an invalid phone number', async () => {
    const res = await request(app)
      .post('/api/v1/auth/forgot-password/sms')
      .send({ phone: 'not-a-phone' });

    expect(res.status).toBe(422);
    expect(sendOtp).not.toHaveBeenCalled();
  });

  it('sends an OTP and creates a reset request for a registered phone', async () => {
    prisma.user.findUnique.mockResolvedValue(USER);
    sendOtp.mockResolvedValue({ requestId: 'hubtel-req-1', prefix: '12' });
    prisma.passwordResetRequest.create.mockResolvedValue(RESET_REQUEST);

    const res = await request(app)
      .post('/api/v1/auth/forgot-password/sms')
      .send({ phone: PHONE });

    expect(res.status).toBe(200);
    expect(sendOtp).toHaveBeenCalledWith(PHONE);
    expect(prisma.passwordResetRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId: USER.id, phone: PHONE }),
      }),
    );
    expect(res.body.data.requestId).toBe('hubtel-req-1');
  });

  it('does not call Hubtel and gives a generic response for an unregistered phone', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    const res = await request(app)
      .post('/api/v1/auth/forgot-password/sms')
      .send({ phone: PHONE });

    expect(res.status).toBe(200);
    expect(sendOtp).not.toHaveBeenCalled();
    expect(prisma.passwordResetRequest.create).not.toHaveBeenCalled();
    expect(res.body.data.requestId).toBeDefined();
  });
});

// ── POST /api/v1/auth/forgot-password/sms/verify ──────────────────────────────
describe('POST /api/v1/auth/forgot-password/sms/verify', () => {
  it('returns a resetToken when the OTP is valid', async () => {
    prisma.passwordResetRequest.findUnique.mockResolvedValue({ ...RESET_REQUEST });
    verifyOtp.mockResolvedValue(true);
    prisma.passwordResetRequest.update.mockResolvedValue({ ...RESET_REQUEST, verified: true });

    const res = await request(app)
      .post('/api/v1/auth/forgot-password/sms/verify')
      .send({ requestId: RESET_REQUEST.requestId, otpCode: '123456' });

    expect(res.status).toBe(200);
    expect(verifyOtp).toHaveBeenCalledWith({
      requestId: RESET_REQUEST.requestId,
      otpCode: '123456',
      prefix: RESET_REQUEST.prefix,
    });
    expect(res.body.data.resetToken).toBeDefined();

    const payload = verifyPasswordResetToken(res.body.data.resetToken as string);
    expect(payload.sub).toBe(USER.id);
    expect(payload.resetRequestId).toBe(RESET_REQUEST.id);
  });

  it('returns 400 when Hubtel rejects the code', async () => {
    prisma.passwordResetRequest.findUnique.mockResolvedValue({ ...RESET_REQUEST });
    verifyOtp.mockResolvedValue(false);

    const res = await request(app)
      .post('/api/v1/auth/forgot-password/sms/verify')
      .send({ requestId: RESET_REQUEST.requestId, otpCode: '000000' });

    expect(res.status).toBe(400);
  });

  it('returns 400 for an unknown or expired requestId', async () => {
    prisma.passwordResetRequest.findUnique.mockResolvedValue({
      ...RESET_REQUEST,
      expiresAt: new Date(Date.now() - 1000),
    });

    const res = await request(app)
      .post('/api/v1/auth/forgot-password/sms/verify')
      .send({ requestId: RESET_REQUEST.requestId, otpCode: '123456' });

    expect(res.status).toBe(400);
    expect(verifyOtp).not.toHaveBeenCalled();
  });
});

// ── POST /api/v1/auth/forgot-password/sms/reset ───────────────────────────────
describe('POST /api/v1/auth/forgot-password/sms/reset', () => {
  it('returns 401 for a garbage reset token', async () => {
    const res = await request(app)
      .post('/api/v1/auth/forgot-password/sms/reset')
      .send({ resetToken: 'not-a-jwt', newPassword: 'NewPassword1' });

    expect(res.status).toBe(401);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('returns 401 when the underlying reset request was already consumed', async () => {
    const { signPasswordResetToken } = jest.requireActual('../utils/jwt') as typeof import('../utils/jwt');
    const token = signPasswordResetToken({ sub: USER.id, resetRequestId: RESET_REQUEST.id });
    prisma.passwordResetRequest.findUnique.mockResolvedValue({
      ...RESET_REQUEST,
      verified: true,
      consumed: true,
    });

    const res = await request(app)
      .post('/api/v1/auth/forgot-password/sms/reset')
      .send({ resetToken: token, newPassword: 'NewPassword1' });

    expect(res.status).toBe(401);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('resets the password and consumes the request on a valid verified token', async () => {
    const { signPasswordResetToken } = jest.requireActual('../utils/jwt') as typeof import('../utils/jwt');
    const token = signPasswordResetToken({ sub: USER.id, resetRequestId: RESET_REQUEST.id });
    prisma.passwordResetRequest.findUnique.mockResolvedValue({
      ...RESET_REQUEST,
      verified: true,
      consumed: false,
    });
    prisma.$transaction.mockResolvedValue([{}, {}]);

    const res = await request(app)
      .post('/api/v1/auth/forgot-password/sms/reset')
      .send({ resetToken: token, newPassword: 'NewPassword1' });

    expect(res.status).toBe(200);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('returns 422 when the new password fails complexity rules', async () => {
    const res = await request(app)
      .post('/api/v1/auth/forgot-password/sms/reset')
      .send({ resetToken: 'whatever', newPassword: 'short' });

    expect(res.status).toBe(422);
  });
});
