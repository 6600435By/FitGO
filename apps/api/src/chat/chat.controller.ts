import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@fitgo/shared-types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { JwtPayload } from '../auth/jwt.strategy';
import { ChatService } from './chat.service';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { CreateStaffConversationDto } from './dto/create-staff-conversation.dto';
import { SendChatMessageDto } from './dto/send-chat-message.dto';

const CHAT_ROLES = [
  UserRole.CLIENT,
  UserRole.TRAINER,
  UserRole.SPECIALIST,
  UserRole.ADMIN,
  UserRole.MANAGER,
  UserRole.SUPER_ADMIN,
  UserRole.TECH,
] as const;

@Controller('chat')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...CHAT_ROLES)
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Get('unread-count')
  getUnreadCount(@CurrentUser() user: JwtPayload) {
    return this.chatService.getUnreadCount(user);
  }

  @Get('conversations')
  listConversations(
    @CurrentUser() user: JwtPayload,
    @Query('scope') scope?: 'clients' | 'admin' | 'trainers' | 'staff',
  ) {
    return this.chatService.listConversations(user, scope);
  }

  @Get('staff-recipients')
  listStaffRecipients(@CurrentUser() user: JwtPayload) {
    return this.chatService.listStaffRecipients(user);
  }

  @Post('conversations')
  @Roles(UserRole.CLIENT)
  createConversation(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateConversationDto,
  ) {
    return this.chatService.createConversation(user, dto.kind, dto.trainerId);
  }

  @Post('conversations/staff')
  @Roles(
    UserRole.TRAINER,
    UserRole.SPECIALIST,
    UserRole.ADMIN,
    UserRole.MANAGER,
    UserRole.SUPER_ADMIN,
    UserRole.TECH,
  )
  openStaffChat(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateStaffConversationDto,
  ) {
    return this.chatService.getOrCreateStaffConversation(user, dto.peerId);
  }

  @Post('conversations/trainer-admin')
  @Roles(UserRole.TRAINER, UserRole.SPECIALIST)
  openTrainerAdminChat(@CurrentUser() user: JwtPayload) {
    return this.chatService.getOrCreateTrainerAdminConversation(user);
  }

  @Post('conversations/trainer/:clientId')
  @Roles(UserRole.TRAINER)
  openTrainerClientChat(
    @CurrentUser() user: JwtPayload,
    @Param('clientId') clientId: string,
  ) {
    return this.chatService.getOrCreateTrainerClientConversation(user, clientId);
  }

  @Get('conversations/:id/messages')
  getMessages(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ) {
    return this.chatService.getMessages(user, id);
  }

  @Post('conversations/:id/messages')
  sendMessage(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: SendChatMessageDto,
  ) {
    return this.chatService.sendMessage(user, id, dto.body);
  }
}
