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
import { SendChatMessageDto } from './dto/send-chat-message.dto';

@Controller('chat')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.CLIENT, UserRole.TRAINER, UserRole.ADMIN)
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Get('unread-count')
  getUnreadCount(@CurrentUser() user: JwtPayload) {
    return this.chatService.getUnreadCount(user);
  }

  @Get('conversations')
  listConversations(
    @CurrentUser() user: JwtPayload,
    @Query('scope') scope?: 'clients' | 'admin' | 'trainers',
  ) {
    return this.chatService.listConversations(user, scope);
  }

  @Post('conversations')
  @Roles(UserRole.CLIENT)
  createConversation(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateConversationDto,
  ) {
    return this.chatService.createConversation(user, dto.kind, dto.trainerId);
  }

  @Post('conversations/trainer-admin')
  @Roles(UserRole.TRAINER)
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
