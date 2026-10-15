import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConversationKind, Role } from '@prisma/client';
import { AdminPermission, UserRole } from '@fitgo/shared-types';
import type { JwtPayload } from '../auth/jwt.strategy';
import { requireClubId } from '../auth/require-club-id';
import { AdminPermissionsService } from '../auth/admin-permissions.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';

const STAFF_CHAT_ROLES: Role[] = [
  Role.ADMIN,
  Role.TRAINER,
  Role.SPECIALIST,
  Role.MANAGER,
  Role.SUPER_ADMIN,
  Role.TECH,
];

const ROLE_LABEL: Partial<Record<Role, string>> = {
  [Role.ADMIN]: 'Админ',
  [Role.TRAINER]: 'Тренер',
  [Role.SPECIALIST]: 'SPA',
  [Role.MANAGER]: 'Руководитель',
  [Role.SUPER_ADMIN]: 'Руководитель',
  [Role.TECH]: 'Техник',
};

const conversationListInclude = {
  client: { include: { roles: true as const } },
  trainer: true as const,
  members: {
    include: {
      user: {
        select: { id: true, firstName: true, lastName: true },
      },
    },
  },
  messages: {
    orderBy: { createdAt: 'desc' as const },
    take: 1,
  },
};

@Injectable()
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly adminPermissions: AdminPermissionsService,
    private readonly notifications: NotificationsService,
  ) {}

  private isStaffMessenger(user: JwtPayload) {
    return user.roles.some((r) =>
      STAFF_CHAT_ROLES.includes(r as Role),
    );
  }

  private isGroupManager(user: JwtPayload) {
    return (
      user.roles.includes(UserRole.MANAGER) ||
      user.roles.includes(UserRole.SUPER_ADMIN)
    );
  }

  private staffAndGroupListWhere(userId: string) {
    return {
      OR: [
        {
          kind: ConversationKind.STAFF,
          OR: [{ clientId: userId }, { trainerId: userId }],
        },
        {
          kind: ConversationKind.GROUP,
          members: { some: { userId } },
        },
      ],
    };
  }

  async getUnreadCount(user: JwtPayload) {
    if (user.roles.includes(UserRole.ADMIN)) {
      await this.ensureAdminCanMessage(user);
    }
    return { chat: await this.sumUnreadConversations(user) };
  }

  /** Unread total for push badge — skips admin permission gate. */
  private async sumUnreadConversations(user: JwtPayload) {
    let conversations;
    if (user.roles.includes(UserRole.TRAINER)) {
      const [clients, admin, staff] = await Promise.all([
        this.listConversationsSkippingAdminGate(user, 'clients'),
        this.listConversationsSkippingAdminGate(user, 'admin'),
        this.listConversationsSkippingAdminGate(user, 'staff'),
      ]);
      conversations = [...clients, ...admin, ...staff];
    } else if (user.roles.includes(UserRole.SPECIALIST)) {
      const [admin, staff] = await Promise.all([
        this.listConversationsSkippingAdminGate(user, 'admin'),
        this.listConversationsSkippingAdminGate(user, 'staff'),
      ]);
      conversations = [...admin, ...staff];
    } else if (
      user.roles.includes(UserRole.MANAGER) ||
      user.roles.includes(UserRole.SUPER_ADMIN) ||
      user.roles.includes(UserRole.TECH)
    ) {
      conversations = await this.listConversationsSkippingAdminGate(
        user,
        'staff',
      );
    } else {
      conversations = await this.listConversationsSkippingAdminGate(user);
    }
    return conversations.reduce((sum, c) => sum + c.unreadCount, 0);
  }

  private async listConversationsSkippingAdminGate(
    user: JwtPayload,
    scope?: 'clients' | 'admin' | 'trainers' | 'staff',
  ) {
    const where = this.buildConversationListWhere(user, scope);
    const conversations = await this.prisma.conversation.findMany({
      where,
      include: conversationListInclude,
      orderBy: { lastMessageAt: 'desc' },
    });

    return Promise.all(
      conversations.map(async (conversation) => {
        const unreadCount = await this.countUnread(conversation, user.sub);
        const lastMessage = conversation.messages[0];
        return this.toConversationSummary(
          conversation,
          user,
          lastMessage?.body,
          unreadCount,
        );
      }),
    );
  }

  async listConversations(
    user: JwtPayload,
    scope?: 'clients' | 'admin' | 'trainers' | 'staff',
  ) {
    if (user.roles.includes(UserRole.ADMIN)) {
      await this.ensureAdminCanMessage(user);
    }

    const where = this.buildConversationListWhere(user, scope);
    const conversations = await this.prisma.conversation.findMany({
      where,
      include: conversationListInclude,
      orderBy: { lastMessageAt: 'desc' },
    });

    const summaries = await Promise.all(
      conversations.map(async (conversation) => {
        const unreadCount = await this.countUnread(conversation, user.sub);
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

  private async countUnread(
    conversation: { id: string; kind: ConversationKind },
    userId: string,
  ) {
    if (conversation.kind === ConversationKind.GROUP) {
      const membership = await this.prisma.conversationMember.findUnique({
        where: {
          conversationId_userId: {
            conversationId: conversation.id,
            userId,
          },
        },
        select: { lastReadAt: true },
      });
      return this.prisma.chatMessage.count({
        where: {
          conversationId: conversation.id,
          senderId: { not: userId },
          ...(membership?.lastReadAt
            ? { createdAt: { gt: membership.lastReadAt } }
            : {}),
        },
      });
    }

    return this.prisma.chatMessage.count({
      where: {
        conversationId: conversation.id,
        senderId: { not: userId },
        readAt: null,
      },
    });
  }

  async createConversation(user: JwtPayload, kind: 'admin' | 'trainer', trainerId?: string) {
    if (!user.roles.includes(UserRole.CLIENT)) {
      throw new ForbiddenException('Только клиент может начать новый чат');
    }

    const clubId = requireClubId(user);

    if (kind === 'trainer') {
      if (!trainerId) {
        throw new ForbiddenException('Выберите тренера');
      }
      await this.ensureTrainerEligible(clubId, trainerId);
    }

    const conversationKey =
      kind === 'admin'
        ? `admin:${clubId}:${user.sub}`
        : `trainer:${user.sub}:${trainerId}`;

    const conversation = await this.prisma.conversation.upsert({
      where: { conversationKey },
      create: {
        clubId,
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
    if (user.roles.includes(UserRole.ADMIN)) {
      await this.ensureAdminCanMessage(user);
    }

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

    if (conversation.kind === ConversationKind.GROUP) {
      await this.prisma.conversationMember.updateMany({
        where: {
          conversationId,
          userId: user.sub,
        },
        data: { lastReadAt: new Date() },
      });
    } else {
      await this.prisma.chatMessage.updateMany({
        where: {
          conversationId,
          senderId: { not: user.sub },
          readAt: null,
        },
        data: { readAt: new Date() },
      });
    }

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
    if (user.roles.includes(UserRole.ADMIN)) {
      await this.ensureAdminCanMessage(user);
    }

    const conversation = await this.ensureConversationAccess(user, conversationId);

    if (
      conversation.kind === ConversationKind.STAFF ||
      conversation.kind === ConversationKind.GROUP
    ) {
      // membership already checked in ensureConversationAccess
    } else if (user.roles.includes(UserRole.TRAINER)) {
      if (conversation.kind === ConversationKind.TRAINER_ADMIN) {
        if (conversation.clientId !== user.sub) {
          throw new ForbiddenException('Нет доступа к этому чату');
        }
      } else {
        await this.ensureTrainerCanMessageClient(user, conversation.clientId);
      }
    } else if (user.roles.includes(UserRole.SPECIALIST)) {
      if (
        conversation.kind !== ConversationKind.TRAINER_ADMIN ||
        conversation.clientId !== user.sub
      ) {
        throw new ForbiddenException('Нет доступа к этому чату');
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

    const senderName =
      `${message.sender.firstName} ${message.sender.lastName}`.trim();
    void this.notifyChatPeers(conversation, user.sub, senderName, body.trim());

    return {
      id: message.id,
      body: message.body,
      senderId: message.senderId,
      senderName,
      isMine: true,
      readAt: message.readAt?.toISOString(),
      createdAt: message.createdAt.toISOString(),
    };
  }

  async listStaffRecipients(user: JwtPayload) {
    if (!this.isStaffMessenger(user)) {
      throw new ForbiddenException('Нет доступа к списку команды');
    }
    if (user.roles.includes(UserRole.ADMIN)) {
      await this.ensureAdminCanMessage(user);
    }
    const clubId = requireClubId(user);
    const staff = await this.prisma.user.findMany({
      where: {
        clubId,
        isActive: true,
        archivedAt: null,
        id: { not: user.sub },
        roles: { some: { role: { in: STAFF_CHAT_ROLES } } },
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        roles: { select: { role: true } },
      },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      take: 200,
    });

    return staff.map((s) => {
      const role =
        STAFF_CHAT_ROLES.find((r) => s.roles.some((x) => x.role === r)) ??
        Role.TRAINER;
      return {
        id: s.id,
        firstName: s.firstName,
        lastName: s.lastName,
        roleLabel: ROLE_LABEL[role] ?? String(role),
      };
    });
  }

  async createGroupConversation(
    user: JwtPayload,
    title: string,
    memberIds: string[],
  ) {
    if (!this.isGroupManager(user)) {
      throw new ForbiddenException(
        'Только управляющий может создать групповой чат',
      );
    }
    const clubId = requireClubId(user);
    const trimmed = title.trim();
    if (!trimmed || trimmed.length > 80) {
      throw new BadRequestException('Название группы: 1–80 символов');
    }

    const uniqueMemberIds = [...new Set(memberIds.filter((id) => id !== user.sub))];
    if (uniqueMemberIds.length === 0) {
      throw new BadRequestException('Добавьте хотя бы одного сотрудника');
    }

    const staff = await this.prisma.user.findMany({
      where: {
        id: { in: uniqueMemberIds },
        clubId,
        isActive: true,
        archivedAt: null,
        roles: { some: { role: { in: STAFF_CHAT_ROLES } } },
      },
      select: { id: true },
    });
    if (staff.length !== uniqueMemberIds.length) {
      throw new NotFoundException('Не все сотрудники найдены в клубе');
    }

    const allMemberIds = [user.sub, ...uniqueMemberIds];
    const conversation = await this.prisma.$transaction(async (tx) => {
      const created = await tx.conversation.create({
        data: {
          clubId,
          clientId: user.sub,
          kind: ConversationKind.GROUP,
          title: trimmed,
          conversationKey: `group:${clubId}:tmp-${user.sub}-${Date.now()}`,
          members: {
            create: allMemberIds.map((userId) => ({ userId })),
          },
        },
      });
      return tx.conversation.update({
        where: { id: created.id },
        data: { conversationKey: `group:${clubId}:${created.id}` },
        include: conversationListInclude,
      });
    });

    return this.toConversationSummary(conversation, user, undefined, 0);
  }

  async updateGroupConversation(
    user: JwtPayload,
    conversationId: string,
    input: {
      title?: string;
      addMemberIds?: string[];
      removeMemberIds?: string[];
    },
  ) {
    if (!this.isGroupManager(user)) {
      throw new ForbiddenException(
        'Только управляющий может изменить групповой чат',
      );
    }

    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: conversationListInclude,
    });
    if (!conversation || conversation.kind !== ConversationKind.GROUP) {
      throw new NotFoundException('Групповой чат не найден');
    }
    if (conversation.clubId !== user.clubId) {
      throw new ForbiddenException('Нет доступа к этому чату');
    }

    const isMember = conversation.members.some((m) => m.userId === user.sub);
    if (!isMember) {
      throw new ForbiddenException('Нет доступа к этому чату');
    }

    const clubId = requireClubId(user);
    const data: { title?: string } = {};
    if (input.title !== undefined) {
      const trimmed = input.title.trim();
      if (!trimmed || trimmed.length > 80) {
        throw new BadRequestException('Название группы: 1–80 символов');
      }
      data.title = trimmed;
    }

    const addIds = [
      ...new Set((input.addMemberIds ?? []).filter((id) => id !== user.sub)),
    ];
    const removeIds = [
      ...new Set((input.removeMemberIds ?? []).filter((id) => id !== user.sub)),
    ];

    if (addIds.length > 0) {
      const staff = await this.prisma.user.findMany({
        where: {
          id: { in: addIds },
          clubId,
          isActive: true,
          archivedAt: null,
          roles: { some: { role: { in: STAFF_CHAT_ROLES } } },
        },
        select: { id: true },
      });
      if (staff.length !== addIds.length) {
        throw new NotFoundException('Не все сотрудники найдены в клубе');
      }
    }

    const existingIds = new Set(conversation.members.map((m) => m.userId));
    const toAdd = addIds.filter((id) => !existingIds.has(id));
    const toRemove = removeIds.filter((id) => existingIds.has(id));

    const updated = await this.prisma.$transaction(async (tx) => {
      if (Object.keys(data).length > 0) {
        await tx.conversation.update({
          where: { id: conversationId },
          data,
        });
      }
      if (toAdd.length > 0) {
        await tx.conversationMember.createMany({
          data: toAdd.map((userId) => ({
            conversationId,
            userId,
          })),
          skipDuplicates: true,
        });
      }
      if (toRemove.length > 0) {
        await tx.conversationMember.deleteMany({
          where: {
            conversationId,
            userId: { in: toRemove },
          },
        });
      }
      return tx.conversation.findUniqueOrThrow({
        where: { id: conversationId },
        include: conversationListInclude,
      });
    });

    return this.toConversationSummary(updated, user, undefined, 0);
  }

  async getOrCreateStaffConversation(user: JwtPayload, peerId: string) {
    if (!this.isStaffMessenger(user)) {
      throw new ForbiddenException('Нет доступа к чату команды');
    }
    if (user.roles.includes(UserRole.ADMIN)) {
      await this.ensureAdminCanMessage(user);
    }
    if (peerId === user.sub) {
      throw new ForbiddenException('Нельзя написать себе');
    }

    const clubId = requireClubId(user);
    const peer = await this.prisma.user.findFirst({
      where: {
        id: peerId,
        clubId,
        isActive: true,
        archivedAt: null,
        roles: { some: { role: { in: STAFF_CHAT_ROLES } } },
      },
      select: { id: true },
    });
    if (!peer) {
      throw new NotFoundException('Сотрудник не найден');
    }

    const [a, b] = [user.sub, peerId].sort();
    const conversationKey = `staff:${clubId}:${a}:${b}`;
    const conversation = await this.prisma.conversation.upsert({
      where: { conversationKey },
      create: {
        clubId,
        clientId: a,
        trainerId: b,
        kind: ConversationKind.STAFF,
        conversationKey,
      },
      update: {},
      include: { client: { include: { roles: true } }, trainer: true },
    });

    return this.toConversationSummary(conversation, user, undefined, 0);
  }

  async getOrCreateTrainerClientConversation(
    user: JwtPayload,
    clientId: string,
  ) {
    await this.ensureTrainerCanMessageClient(user, clientId);

    const clubId = requireClubId(user);
    const conversationKey = `trainer:${clientId}:${user.sub}`;
    const conversation = await this.prisma.conversation.upsert({
      where: { conversationKey },
      create: {
        clubId,
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
    const isTrainer = user.roles.includes(UserRole.TRAINER);
    const isSpecialist = user.roles.includes(UserRole.SPECIALIST);
    if (!isTrainer && !isSpecialist) {
      throw new ForbiddenException(
        'Только тренер или специалист может открыть этот чат',
      );
    }

    const clubId = requireClubId(user);
    const conversationKey = isSpecialist
      ? `specialist-admin:${clubId}:${user.sub}`
      : `trainer-admin:${clubId}:${user.sub}`;
    const conversation = await this.prisma.conversation.upsert({
      where: { conversationKey },
      create: {
        clubId,
        clientId: user.sub,
        kind: ConversationKind.TRAINER_ADMIN,
        trainerId: user.sub,
        conversationKey,
      },
      update: {},
      include: { client: { include: { roles: true } }, trainer: true },
    });

    return this.toConversationSummary(conversation, user, undefined, 0);
  }

  private buildConversationListWhere(
    user: JwtPayload,
    scope?: 'clients' | 'admin' | 'trainers' | 'staff',
  ) {
    if (user.roles.includes(UserRole.CLIENT)) {
      return { clientId: user.sub };
    }

    const staffAndGroup = this.staffAndGroupListWhere(user.sub);

    if (
      user.roles.includes(UserRole.MANAGER) ||
      user.roles.includes(UserRole.SUPER_ADMIN) ||
      user.roles.includes(UserRole.TECH)
    ) {
      return staffAndGroup;
    }

    if (user.roles.includes(UserRole.TRAINER)) {
      if (scope === 'admin') {
        return {
          clientId: user.sub,
          kind: ConversationKind.TRAINER_ADMIN,
        };
      }
      if (scope === 'staff') {
        return staffAndGroup;
      }
      return { trainerId: user.sub, kind: ConversationKind.TRAINER };
    }

    if (user.roles.includes(UserRole.SPECIALIST)) {
      if (scope === 'staff') {
        return staffAndGroup;
      }
      return {
        clientId: user.sub,
        kind: ConversationKind.TRAINER_ADMIN,
      };
    }

    if (user.roles.includes(UserRole.ADMIN)) {
      const clubId = requireClubId(user);
      if (scope === 'clients') {
        return { clubId, kind: ConversationKind.ADMIN };
      }
      if (scope === 'trainers') {
        return {
          clubId,
          OR: [
            { kind: ConversationKind.TRAINER_ADMIN },
            ...staffAndGroup.OR,
          ],
        };
      }
      if (scope === 'staff') {
        return {
          clubId,
          ...staffAndGroup,
        };
      }
      return {
        clubId,
        OR: [
          {
            kind: {
              in: [ConversationKind.ADMIN, ConversationKind.TRAINER_ADMIN],
            },
          },
          ...staffAndGroup.OR,
        ],
      };
    }

    throw new ForbiddenException();
  }

  private async ensureConversationAccess(user: JwtPayload, conversationId: string) {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: {
        client: { include: { roles: true } },
        trainer: true,
        members: {
          include: {
            user: {
              select: { id: true, firstName: true, lastName: true },
            },
          },
        },
      },
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
    const isSpecialistOnAdminChat =
      user.roles.includes(UserRole.SPECIALIST) &&
      conversation.kind === ConversationKind.TRAINER_ADMIN &&
      conversation.clientId === user.sub;
    const isAdmin =
      user.roles.includes(UserRole.ADMIN) &&
      conversation.clubId === user.clubId &&
      (conversation.kind === ConversationKind.ADMIN ||
        conversation.kind === ConversationKind.TRAINER_ADMIN ||
        conversation.kind === ConversationKind.STAFF);
    const isStaffPeer =
      conversation.kind === ConversationKind.STAFF &&
      this.isStaffMessenger(user) &&
      conversation.clubId === user.clubId &&
      (conversation.clientId === user.sub ||
        conversation.trainerId === user.sub);
    const isGroupMember =
      conversation.kind === ConversationKind.GROUP &&
      this.isStaffMessenger(user) &&
      conversation.clubId === user.clubId &&
      conversation.members.some((m) => m.userId === user.sub);

    if (
      !isClient &&
      !isTrainerOnClientChat &&
      !isTrainerOnAdminChat &&
      !isSpecialistOnAdminChat &&
      !isAdmin &&
      !isStaffPeer &&
      !isGroupMember
    ) {
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
      title?: string | null;
      lastMessageAt: Date;
      client: {
        firstName: string;
        lastName: string;
        roles?: Array<{ role: Role }>;
      };
      trainer: { firstName: string; lastName: string } | null;
      members?: Array<{
        userId: string;
        user: { id: string; firstName: string; lastName: string };
      }>;
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
      const isStaffPeer =
        user.roles.includes(UserRole.TRAINER) ||
        user.roles.includes(UserRole.SPECIALIST);
      const peerIsSpecialist = conversation.client.roles?.some(
        (r) => r.role === Role.SPECIALIST,
      );
      return {
        id: conversation.id,
        kind: 'TRAINER_ADMIN' as const,
        title: isStaffPeer ? 'Администрация клуба' : clientName,
        subtitle: isStaffPeer
          ? 'Чат с администрацией'
          : peerIsSpecialist
            ? 'Чат со специалистом'
            : 'Чат с тренером',
        clientId: conversation.clientId,
        trainerId: conversation.trainerId ?? undefined,
        lastMessage,
        lastMessageAt: conversation.lastMessageAt.toISOString(),
        unreadCount,
      };
    }

    if (conversation.kind === ConversationKind.STAFF) {
      const peer =
        conversation.clientId === user.sub
          ? conversation.trainer
          : conversation.client;
      const peerName = peer
        ? `${peer.firstName} ${peer.lastName}`.trim()
        : 'Сотрудник';
      return {
        id: conversation.id,
        kind: 'STAFF' as const,
        title: peerName,
        subtitle: 'Команда',
        clientId: conversation.clientId,
        trainerId: conversation.trainerId ?? undefined,
        lastMessage,
        lastMessageAt: conversation.lastMessageAt.toISOString(),
        unreadCount,
      };
    }

    if (conversation.kind === ConversationKind.GROUP) {
      const members = conversation.members ?? [];
      const memberNames = members
        .map((m) => `${m.user.firstName} ${m.user.lastName}`.trim())
        .filter(Boolean);
      const subtitle =
        memberNames.length <= 3
          ? memberNames.join(', ')
          : `${memberNames.slice(0, 2).join(', ')} и ещё ${memberNames.length - 2}`;
      return {
        id: conversation.id,
        kind: 'GROUP' as const,
        title: conversation.title?.trim() || 'Группа',
        subtitle: subtitle || 'Групповой чат',
        clientId: conversation.clientId,
        memberIds: members.map((m) => m.userId),
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

  private chatInboxPath(roles: UserRole[], conversationId?: string) {
    let base = '/client/notifications';
    if (
      roles.includes(UserRole.SUPER_ADMIN) ||
      roles.includes(UserRole.MANAGER)
    ) {
      base = '/super-admin/messages';
    } else if (roles.includes(UserRole.ADMIN)) {
      base = '/admin/notifications';
    } else if (roles.includes(UserRole.TRAINER)) {
      base = '/trainer/messages';
    } else if (roles.includes(UserRole.SPECIALIST)) {
      base = '/specialist/messages';
    } else if (roles.includes(UserRole.TECH)) {
      base = '/tech';
    }

    if (conversationId && base !== '/tech') {
      return `${base}?c=${encodeURIComponent(conversationId)}`;
    }
    return base;
  }

  private async notifyChatRecipient(
    userId: string,
    senderId: string,
    title: string,
    preview: string,
    conversationId?: string,
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        email: true,
        clubId: true,
        roles: { select: { role: true } },
      },
    });
    if (!user) return;

    const roles = user.roles.map((r) => r.role as UserRole);
    let badge = 0;
    try {
      badge = await this.sumUnreadConversations({
        sub: userId,
        email: user.email,
        clubId: user.clubId ?? undefined,
        roles,
      });
    } catch {
      badge = 0;
    }

    await this.notifications.sendDirectMessage(userId, title, preview, senderId, {
      url: this.chatInboxPath(roles, conversationId),
      badge,
      tag: conversationId ? `chat:${conversationId}` : undefined,
    });
  }

  private async notifyChatPeers(
    conversation: {
      id?: string;
      kind: ConversationKind;
      clientId: string;
      trainerId: string | null;
      clubId: string;
    },
    senderId: string,
    senderName: string,
    body: string,
  ) {
    const preview = body.length > 120 ? `${body.slice(0, 117)}…` : body;
    const title = `Сообщение: ${senderName}`;
    const conversationId = conversation.id;
    try {
      if (conversation.kind === ConversationKind.GROUP && conversation.id) {
        const members = await this.prisma.conversationMember.findMany({
          where: {
            conversationId: conversation.id,
            userId: { not: senderId },
          },
          select: { userId: true },
        });
        await Promise.all(
          members.map((m) =>
            this.notifyChatRecipient(
              m.userId,
              senderId,
              title,
              preview,
              conversationId,
            ),
          ),
        );
        return;
      }

      if (conversation.kind === ConversationKind.STAFF) {
        const peerId =
          conversation.clientId === senderId
            ? conversation.trainerId
            : conversation.clientId;
        if (peerId) {
          await this.notifyChatRecipient(
            peerId,
            senderId,
            title,
            preview,
            conversationId,
          );
        }
        return;
      }

      if (conversation.kind === ConversationKind.TRAINER) {
        const peerId =
          conversation.clientId === senderId
            ? conversation.trainerId
            : conversation.clientId;
        if (peerId) {
          await this.notifyChatRecipient(
            peerId,
            senderId,
            title,
            preview,
            conversationId,
          );
        }
        return;
      }

      if (conversation.kind === ConversationKind.ADMIN) {
        if (conversation.clientId === senderId) {
          const admins = await this.prisma.user.findMany({
            where: {
              clubId: conversation.clubId,
              isActive: true,
              roles: { some: { role: Role.ADMIN } },
            },
            select: { id: true },
            take: 20,
          });
          await Promise.all(
            admins.map((a) =>
              this.notifyChatRecipient(
                a.id,
                senderId,
                title,
                preview,
                conversationId,
              ),
            ),
          );
        } else {
          await this.notifyChatRecipient(
            conversation.clientId,
            senderId,
            title,
            preview,
            conversationId,
          );
        }
        return;
      }

      if (conversation.kind === ConversationKind.TRAINER_ADMIN) {
        if (conversation.clientId === senderId) {
          const admins = await this.prisma.user.findMany({
            where: {
              clubId: conversation.clubId,
              isActive: true,
              roles: { some: { role: Role.ADMIN } },
            },
            select: { id: true },
            take: 20,
          });
          await Promise.all(
            admins.map((a) =>
              this.notifyChatRecipient(
                a.id,
                senderId,
                title,
                preview,
                conversationId,
              ),
            ),
          );
        } else {
          await this.notifyChatRecipient(
            conversation.clientId,
            senderId,
            title,
            preview,
            conversationId,
          );
        }
      }
    } catch {
      // push is best-effort
    }
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
    const eligibleIds = await this.getEligibleClientIds(
      user.sub,
      requireClubId(user),
    );
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

  private async ensureAdminCanMessage(user: JwtPayload) {
    const allowed = await this.adminPermissions.hasAnyPermission(user, [
      AdminPermission.NOTIFICATIONS_SEND,
      AdminPermission.CLIENTS_MESSAGE,
    ]);
    if (!allowed) {
      throw new ForbiddenException('Недостаточно прав для сообщений');
    }
  }
}
