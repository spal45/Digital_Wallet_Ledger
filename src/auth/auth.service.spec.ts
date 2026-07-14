import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';

describe('AuthService', () => {
  let service: AuthService;
  let prisma: { user: { findUnique: jest.Mock; create: jest.Mock } };
  let jwtService: { signAsync: jest.Mock };

  beforeEach(async () => {
    prisma = {
      user: {
        findUnique: jest.fn(),
        create: jest.fn(),
      },
    };
    jwtService = {
      signAsync: jest.fn().mockResolvedValue('signed-token'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: jwtService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  describe('register', () => {
    it('throws a conflict if the email is already taken', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'existing-id' });

      await expect(
        service.register({ email: 'taken@example.com', password: 'password123' }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('hashes the password and creates a user', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue({
        id: 'new-id',
        email: 'new@example.com',
        role: 'CUSTOMER',
        passwordHash: 'hashed',
      });

      const result = await service.register({ email: 'new@example.com', password: 'password123' });

      expect(prisma.user.create).toHaveBeenCalledTimes(1);
      const createArgs = prisma.user.create.mock.calls[0][0];
      expect(createArgs.data.email).toBe('new@example.com');
      expect(createArgs.data.passwordHash).not.toBe('password123');
      expect(result).toEqual({ id: 'new-id', email: 'new@example.com', role: 'CUSTOMER' });
    });
  });

  describe('login', () => {
    it('rejects an unknown email', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.login({ email: 'nobody@example.com', password: 'password123' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects an incorrect password', async () => {
      const passwordHash = await argon2.hash('correct-password');
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-id',
        email: 'user@example.com',
        role: 'CUSTOMER',
        passwordHash,
      });

      await expect(
        service.login({ email: 'user@example.com', password: 'wrong-password' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('returns an access token for valid credentials', async () => {
      const passwordHash = await argon2.hash('correct-password');
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-id',
        email: 'user@example.com',
        role: 'CUSTOMER',
        passwordHash,
      });

      const result = await service.login({ email: 'user@example.com', password: 'correct-password' });

      expect(jwtService.signAsync).toHaveBeenCalledWith({
        sub: 'user-id',
        email: 'user@example.com',
        role: 'CUSTOMER',
      });
      expect(result).toEqual({ accessToken: 'signed-token' });
    });
  });
});
