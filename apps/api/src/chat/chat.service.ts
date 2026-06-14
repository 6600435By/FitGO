import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConversationKind, Role } from '@prisma/client';
import { UserRole } from '@fitgo/shared-types';
import type { JwtPayload } from '../auth/jwt.strategy';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ChatService {
  constructor(private readonly prisma: PrismaService) {}

  async listConversations(
    user: JwtPayload,
    scope?: 'clients' | 'admin',
  ) {
    const where = this.buildConversationListWhere(user, scope);
    const conversations = await this.prisma.conversation.findMany({
      where,
      include: {
        client: true,
        trainer: true,
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
      orderBy: { lastMessageAt: 'desc' },
    });

    const summaries = await Promise.all(
      conversations.map(async (conversation) => {
        const unreadCount = await this.prisma.chatMessage.count({
          where: {
            conversationId: conversation.id,
            senderId: { not: user.sub },
            readAt: null,
          },
        });

        const lastMessage = conversation.messages[0];
        return this.toConversationSummary(
          conversation,
          user,
          lastMessage?.body,
          unreadCount,
        );
      }),
    );

    return summaries;
  }

  async createConversation(user: JwtPayload, kind: 'admin' | 'trainer', trainerId?: string) {
    if (!user.roles.includes(UserRole.CLIENT)) {
      throw new ForbiddenException('Только клиент может начать новый чат');
    }

    if (kind === 'trainer') {
      if (!trainerId) {
        throw new ForbiddenException('Выберите тренера');
      }
      await this.ensureTrainerEligible(user.clubId, trainerId);
    }

    const conversationKey =
      kind === 'admin'
        ? `admin:${user.clubId}:${user.sub}`
        : `trainer:${user.sub}:${trainerId}`;

    const conversation = await this.prisma.conversation.upsert({
      where: { conversationKey },
      create: {
        clubId: user.clubId,
        clientId: user.sub,
        kind: kind === 'admin' ? ConversationKind.ADMIN : ConversationKind.TRAINER,
        trainerId: kind === 'trainer' ? trainerId : null,
        conversationKey,
      },
      update: {},
      include: { client: true, trainer: true },
    });

    return this.toConversationSummary(conversation, user, undefined, 0);
  }

  async getMessages(user: JwtPayload, conversationId: string) {
    const conversation = await this.ensureConversationAccess(user, conversationId);

    const messages = await this.prisma.chatMessage.findMany({
      where: { conversationId },
      include: {
        sender: {
          select: { id: true, firstName: true, lastName: true },
        },
      },
      orderBy: { createdAt: 'asc' },
      take: 200,
    });

    await this.prisma.chatMessage.updateMany({
      where: {
        conversationId,
        senderId: { not: user.sub },
        readAt: null,
      },
      data: { readAt: new Date() },
    });

    return {
      conversation: this.toConversationSummary(conversation, user, undefined, 0),
      messages: messages.map((message) => ({
        id: message.id,
        body: message.body,
        senderId: message.senderId,
        senderName: `${message.sender.firstName} ${message.sender.lastName}`.trim(),
        isMine: message.senderId === user.sub,
        readAt: message.readAt?.toISOString(),
        createdAt: message.createdAt.toISOString(),
      })),
    };
  }

  async sendMessage(user: JwtPayload, conversationId: string, body: string) {
    const conversation = await this.ensureConversationAccess(user, conversationId);

    if (user.roles.includes(UserRole.TRAINER)) {
      if (conversation.kind === ConversationKind.TRAINER_ADMIN) {
        if (conversation.clientId !== user.sub) {
          throw new ForbiddenException('Нет доступа к этому чату');
        }
      } else {
        await this.ensureTrainerCanMessageClient(user, conversation.clientId);
      }
    }

    const message = await this.prisma.$transaction(async (tx) => {
      const created = await tx.chatMessage.create({
        data: {
          conversationId,
          senderId: user.sub,
          body: body.trim(),
        },
        include: {
          sender: {
            select: { id: true, firstName: true, lastName: true },
          },
        },
      });

      await tx.conversation.update({
        where: { id: conversationId },
        data: { lastMessageAt: created.createdAt },
      });

      return created;
    });

    return {
      id: message.id,
      body: message.body,
      senderId: message.senderId,
      senderName: `${message.sender.firstName} ${message.sender.lastName}`.trim(),
      isMine: true,
      readAt: message.readAt?.toISOString(),
      createdAt: message.createdAt.toISOString(),
    };
  }

  async getOrCreateTrainerClientConversation(
    user: JwtPayload,
    clientId: string,
  ) {
    await this.ensureTrainerCanMessageClient(user, clientId);

    const conversationKey = `trainer:${clientId}:${user.sub}`;
    const conversation = await this.prisma.conversation.upsert({
      where: { conversationKey },
      create: {
        clubId: user.clubId,
        clientId,
        kind: ConversationKind.TRAINER,
        trainerId: user.sub,
        conversationKey,
      },
      update: {},
      include: { client: true, trainer: true },
    });

    return this.toConversationSummary(conversation, user, undefined, 0);
  }

  async getOrCreateTrainerAdminConversation(user: JwtPayload) {
    if (!user.roles.includes(UserRole.TRAINER)) {
      throw new ForbiddenException('Только тренер может открыть этот чат');
    }

    const conversationKey = `trainer-admin:${user.clubId}:${user.sub}`;
    const conversation = await this.prisma.conversation.upsert({
      where: { conversationKey },
      create: {
        clubId: user.clubId,
        clientId: user.sub,
        kind: ConversationKind.TRAINER_ADMIN,
        trainerId: user.sub,
        conversationKey,
      },
      update: {},
      include: { client: true, trainer: true },
    });

    return this.toConversationSummary(conversation, user, undefined, 0);
  }

  private buildConversationListWhere(
    user: JwtPayload,
    scope?: 'clients' | 'admin',
  ) {
    if (user.roles.includes(UserRole.CLIENT)) {
      return { clientId: user.sub };
    }

    if (user.roles.includes(UserRole.TRAINER)) {
      if (scope === 'admin') {
        return {
          clientId: user.sub,
          kind: ConversationKind.TRAINER_ADMIN,
        };
      }
      return { trainerId: user.sub, kind: ConversationKind.TRAINER };
    }

    if (user.roles.includes(UserRole.ADMIN)) {
      return {
        clubId: user.clubId,
        kind: { in: [ConversationKind.ADMIN, ConversationKind.TRAINER_ADMIN] },
      };
    }

    throw new ForbiddenException();
  }

  private async ensureConversationAccess(user: JwtPayload, conversationId: string) {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: { client: true, trainer: true },
    });

    if (!conversation) {
      throw new NotFoundException('Чат не найден');
    }

    const isClient =
      user.roles.includes(UserRole.CLIENT) && conversation.clientId === user.sub;
    const isTrainerOnClientChat =
      user.roles.includes(UserRole.TRAINER) &&
      conversation.trainerId === user.sub &&
      conversation.kind === ConversationKind.TRAINER;
    const isTrainerOnAdminChat =
      user.roles.includes(UserRole.TRAINER) &&
      conversation.kind === ConversationKind.TRAINER_ADMIN &&
      conversation.clientId === user.sub;
    const isAdmin =
      user.roles.includes(UserRole.ADMIN) &&
      conversation.clubId === user.clubId &&
      (conversation.kind === ConversationKind.ADMIN ||
        conversation.kind === ConversationKind.TRAINER_ADMIN);

    if (!isClient && !isTrainerOnClientChat && !isTrainerOnAdminChat && !isAdmin) {
      throw new ForbiddenException('Нет доступа к этому чату');
    }

    return conversation;
  }

  private toConversationSummary(
    conversation: {
      id: string;
      kind: ConversationKind;
      clientId: string;
      trainerId: string | null;
      lastMessageAt: Date;
      client: { firstName: string; lastName: string };
      trainer: { firstName: string; lastName: string } | null;
    },
    user: JwtPayload,
    lastMessage?: string,
    unreadCount = 0,
  ) {
    const clientName =
      `${conversation.client.firstName} ${conversation.client.lastName}`.trim();

    if (conversation.kind === ConversationKind.ADMIN) {
      const isClient = user.roles.includes(UserRole.CLIENT);
      return {
        id: conversation.id,
        kind: 'ADMIN' as const,
        title: isClient ? 'Администрация клуба' : clientName,
        subtitle: isClient ? undefined : 'Чат с клиентом',
        clientId: conversation.clientId,
        lastMessage,
        lastMessageAt: conversation.lastMessageAt.toISOString(),
        unreadCount,
      };
    }

    if (conversation.kind === ConversationKind.TRAINER_ADMIN) {
      const isTrainer = user.roles.includes(UserRole.TRAINER);
      return {
        id: conversation.id,
        kind: 'TRAINER_ADMIN' as const,
        title: isTrainer ? 'Администрация клуба' : clientName,
        subtitle: isTrainer ? 'Чат с администрацией' : 'Чат с тренером',
        clientId: conversation.clientId,
        trainerId: conversation.trainerId ?? undefined,
        lastMessage,
        lastMessageAt: conversation.lastMessageAt.toISOString(),
        unreadCount,
      };
    }

    const trainerName = conversation.trainer
      ? `${conversation.trainer.firstName} ${conversation.trainer.lastName}`.trim()
      : 'Тренер';
    const isClient = user.roles.includes(UserRole.CLIENT);

    return {
      id: conversation.id,
      kind: 'TRAINER' as const,
      title: isClient ? trainerName : clientName,
      subtitle: isClient ? 'Персональный тренер' : 'Чат с клиентом',
      clientId: conversation.clientId,
      trainerId: conversation.trainerId ?? undefined,
      lastMessage,
      lastMessageAt: conversation.lastMessageAt.toISOString(),
      unreadCount,
    };
  }

  private async ensureTrainerEligible(clubId: string, trainerId: string) {
    const trainer = await this.prisma.user.findFirst({
      where: {
        id: trainerId,
        clubId,
        roles: { some: { role: Role.TRAINER } },
      },
    });
    if (!trainer) {
      throw new NotFoundException('Тренер не найден');
    }
  }

  private async ensureTrainerCanMessageClient(
    user: JwtPayload,
    clientId: string,
  ) {
    const eligibleIds = await this.getEligibleClientIds(user.sub, user.clubId);
    if (!eligibleIds.includes(clientId)) {
      throw new ForbiddenException(
        'Можно писать только клиентам из вашей базы или записанным к вам',
      );
    }
  }

  private async getEligibleClientIds(trainerId: string, clubId: string) {
    const trainer = await this.prisma.user.findUnique({
      where: { id: trainerId },
    });
    if (!trainer) return [];

    const fullName = `${trainer.firstName} ${trainer.lastName}`.trim();
    const nameParts = [trainer.firstName, trainer.lastName].filter(Boolean);

    const [personalBookings, notes, goals, measurements, groupBookings] =
      await Promise.all([
        this.prisma.personalTrainingBooking.findMany({
          where: { trainerId },
          select: { clientId: true },
          distinct: ['clientId'],
        }),
        this.prisma.trainerNote.findMany({
          where: { trainerId },
          select: { clientId: true },
          distinct: ['clientId'],
        }),
        this.prisma.clientGoal.findMany({
          where: { trainerId },
          select: { clientId: true },
          distinct: ['clientId'],
        }),
        this.prisma.clientMeasurement.findMany({
          where: { trainerId },
          select: { clientId: true },
          distinct: ['clientId'],
        }),
        fullName
          ? this.prisma.groupClassBooking.findMany({
              where: {
                client: { clubId },
                OR: nameParts.map((part) => ({
                  trainerName: { contains: part, mode: 'insensitive' as const },
                })),
              },
              select: { clientId: true },
              distinct: ['clientId'],
            })
          : Promise.resolve([]),
      ]);

    const ids = new Set<string>();
    for (const row of [
      ...personalBookings,
      ...notes,
      ...goals,
      ...measurements,
      ...groupBookings,
    ]) {
      ids.add(row.clientId);
    }

    return [...ids];
  }
}
