import { randomBytes } from 'crypto';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AdminTaskStatus, Prisma, Role } from '@prisma/client';
import {
  DISCREPANCY_DEPT_LABELS,
  DISCREPANCY_TAB_DEPTS,
  UserRole,
  discrepancyTabDept,
  discrepancyTaskText,
  type DiscrepancyAssignMode,
  type DiscrepancyAutoRunResult,
  type DiscrepancyTab,
  type DiscrepancyTaskCreateBody,
  type DiscrepancyTaskDept,
  type DiscrepancyTaskLink,
  type DiscrepancyTaskOptions,
  type DiscrepancyTaskRuleDto,
  type DiscrepancyTaskStaff,
  type DiscrepancyTaskSubject,
} from '@fitgo/shared-types';
import type { JwtPayload } from '../auth/jwt.strategy';
import { requireClubId } from '../auth/require-club-id';
import { PrismaService } from '../prisma/prisma.service';
import { minskDay, retentionDays } from './discrepancies-period';
import { DiscrepanciesService } from './discrepancies.service';
import {
  DISCREPANCY_TASK_SOURCE,
  ackDiscrepancyFromTask,
  discrepancyTaskMeta,
} from './discrepancy-task-ack';

const TABS: DiscrepancyTab[] = ['sales', 'spa', 'pt', 'gp', 'segments'];
const ASSIGN_MODES: DiscrepancyAssignMode[] = [
  'LAST_SHIFT',
  'ON_SHIFT',
  'ADMINS',
  'PERFORMER',
  'USER',
];
const DEPTS = Object.keys(DISCREPANCY_DEPT_LABELS) as DiscrepancyTaskDept[];
/** Guard against flooding the admins after a broken sync. */
const MAX_AUTO_PER_RULE = 30;

const DEFAULT_RULES: Record<DiscrepancyTab, Omit<DiscrepancyTaskRuleDto, 'tab'>> =
  {
    sales: {
      enabled: false,
      threshold: 1,
      scope: 'all',
      assignTo: 'LAST_SHIFT',
      dueHours: 24,
      lookbackDays: 1,
    },
    spa: {
      enabled: false,
      threshold: 1,
      scope: 'all',
      assignTo: 'PERFORMER',
      dueHours: 48,
      lookbackDays: 1,
    },
    pt: {
      enabled: false,
      threshold: 1,
      scope: 'all',
      assignTo: 'PERFORMER',
      dueHours: 48,
      lookbackDays: 1,
    },
    gp: {
      enabled: false,
      threshold: 1,
      scope: 'all',
      assignTo: 'PERFORMER',
      dueHours: 24,
      lookbackDays: 1,
    },
    segments: {
      enabled: false,
      threshold: 3,
      scope: 'problems',
      assignTo: 'ADMINS',
      dueHours: 72,
      lookbackDays: 7,
    },
  };

type StaffRow = DiscrepancyTaskStaff & {
  roles: Role[];
  groupPrograms: boolean;
  ptTrainer: boolean;
};

type ShiftRow = { userId: string; startAt: Date; endAt: Date };

type Candidate = {
  tab: DiscrepancyTab;
  itemKey: string;
  fingerprint: string;
  date: string;
  at?: Date;
  performerUserId?: string | null;
  subject: DiscrepancyTaskSubject;
};

@Injectable()
export class DiscrepancyTasksService {
  private readonly logger = new Logger(DiscrepancyTasksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly discrepancies: DiscrepanciesService,
  ) {}

  // ─── Manual ─────────────────────────────────────────────────────────────

  async options(
    user: JwtPayload,
    q: {
      date?: string;
      at?: string;
      tab?: string;
      performerUserId?: string;
    },
  ): Promise<DiscrepancyTaskOptions> {
    const clubId = requireClubId(user);
    const staff = await this.loadStaff(clubId);
    const tab = TABS.includes(q.tab as DiscrepancyTab)
      ? (q.tab as DiscrepancyTab)
      : undefined;
    const depts = tab ? DISCREPANCY_TAB_DEPTS[tab] : DEPTS;
    const at = q.at ? new Date(q.at) : undefined;
    const date =
      q.date?.slice(0, 10) ||
      (at && !Number.isNaN(at.getTime()) ? minskDay(at) : '');
    const list: DiscrepancyTaskStaff[] = staff.map(({ id, name, role }) => ({
      id,
      name,
      role,
    }));

    const suggested = await this.suggestAssignee({
      clubId,
      tab,
      date,
      at,
      performerUserId: q.performerUserId,
      staff,
    });
    return { staff: list, depts, ...suggested };
  }

  async create(user: JwtPayload, body: DiscrepancyTaskCreateBody) {
    const clubId = requireClubId(user);
    const tab = body.tab;
    if (!TABS.includes(tab)) throw new BadRequestException('Неизвестная вкладка');
    const itemKey = body.itemKey?.trim();
    const fp = body.fingerprint?.trim();
    const title = body.title?.trim() ?? '';
    if (!itemKey || !fp) {
      throw new BadRequestException('itemKey и fingerprint обязательны');
    }
    if (title.length < 2) throw new BadRequestException('Введите текст задачи');
    const date = body.date?.slice(0, 10) || null;

    const staff = await this.loadStaff(clubId);
    const assigneeIds = await this.resolveManual(
      clubId,
      body.assignee ?? '',
      date,
      staff,
    );
    if (!assigneeIds.length) {
      throw new BadRequestException('В выбранном подразделении нет сотрудников');
    }
    const count = await this.createTasks(clubId, user.sub, assigneeIds, {
      tab,
      itemKey,
      fingerprint: fp,
      date,
      title,
      description: body.description?.trim() || null,
      dueHours: clampInt(body.dueHours, 1, 24 * 14, 24),
      auto: false,
    });
    return { created: count };
  }

  async links(user: JwtPayload, tab?: string): Promise<DiscrepancyTaskLink[]> {
    const clubId = requireClubId(user);
    const since = new Date();
    since.setUTCDate(since.getUTCDate() - retentionDays());
    const tasks = await this.prisma.adminTask.findMany({
      where: {
        clubId,
        source: DISCREPANCY_TASK_SOURCE,
        status: { not: AdminTaskStatus.CANCELLED },
        createdAt: { gte: since },
      },
      include: { assignee: { select: { firstName: true, lastName: true } } },
      orderBy: { createdAt: 'desc' },
    });
    const byKey = new Map<string, DiscrepancyTaskLink>();
    for (const t of tasks) {
      const meta = discrepancyTaskMeta(t.meta);
      if (!meta || (tab && meta.tab !== tab)) continue;
      const key = `${meta.tab}|${meta.itemKey}`;
      let link = byKey.get(key);
      if (!link) {
        link = {
          tab: meta.tab as DiscrepancyTab,
          itemKey: meta.itemKey,
          status: 'DONE',
          assignees: [],
          auto: Boolean(meta.auto),
          createdAt: t.createdAt.toISOString(),
        };
        byKey.set(key, link);
      }
      if (t.status === AdminTaskStatus.IN_PROGRESS) link.status = 'IN_PROGRESS';
      else if (t.status === AdminTaskStatus.OPEN && link.status === 'DONE') {
        link.status = 'OPEN';
      }
      const name = t.assignee
        ? `${t.assignee.lastName} ${t.assignee.firstName}`.trim()
        : '';
      if (name && !link.assignees.includes(name)) link.assignees.push(name);
    }
    return [...byKey.values()];
  }

  // ─── Assignee inbox (trainers / specialists / admins) ──────────────────

  async mine(user: JwtPayload) {
    const clubId = requireClubId(user);
    const tasks = await this.prisma.adminTask.findMany({
      where: {
        clubId,
        assigneeId: user.sub,
        source: { in: [DISCREPANCY_TASK_SOURCE, 'MANAGER'] },
        status: { in: [AdminTaskStatus.OPEN, AdminTaskStatus.IN_PROGRESS] },
      },
      include: {
        createdBy: { select: { firstName: true, lastName: true } },
      },
      orderBy: [{ dueAt: 'asc' }, { createdAt: 'desc' }],
      take: 100,
    });
    return tasks.map((t) => ({
      id: t.id,
      title: t.title,
      description: t.description ?? undefined,
      status: t.status,
      dueAt: t.dueAt?.toISOString(),
      createdAt: t.createdAt.toISOString(),
      createdBy: t.createdBy
        ? `${t.createdBy.lastName} ${t.createdBy.firstName}`.trim()
        : undefined,
      auto: discrepancyTaskMeta(t.meta)?.auto ?? false,
    }));
  }

  async complete(user: JwtPayload, taskId: string, comment?: string) {
    const clubId = requireClubId(user);
    const task = await this.prisma.adminTask.findFirst({
      where: { id: taskId, clubId, assigneeId: user.sub },
    });
    if (!task) throw new NotFoundException('Задача не найдена');
    const now = new Date();
    await this.prisma.adminTask.update({
      where: { id: task.id },
      data: { status: AdminTaskStatus.DONE, completedAt: now },
    });
    await this.prisma.adminTaskEvent.create({
      data: {
        taskId: task.id,
        actorId: user.sub,
        comment: comment?.trim() ? `Выполнена: ${comment.trim()}` : 'Выполнена',
      },
    });
    if (task.groupId && task.completionMode === 'SHARED') {
      await this.prisma.adminTask.updateMany({
        where: {
          clubId,
          groupId: task.groupId,
          id: { not: task.id },
          status: { in: [AdminTaskStatus.OPEN, AdminTaskStatus.IN_PROGRESS] },
        },
        data: { status: AdminTaskStatus.DONE, completedAt: now },
      });
    }
    await ackDiscrepancyFromTask(this.prisma, task, user.sub, comment);
    return { ok: true };
  }

  // ─── Auto rules ─────────────────────────────────────────────────────────

  async getRules(user: JwtPayload): Promise<DiscrepancyTaskRuleDto[]> {
    const clubId = requireClubId(user);
    const rows = await this.prisma.discrepancyTaskRule.findMany({
      where: { clubId },
    });
    return TABS.map((tab) => {
      const row = rows.find((r) => r.tab === tab);
      if (!row) return { tab, ...DEFAULT_RULES[tab] };
      return {
        tab,
        enabled: row.enabled,
        threshold: row.threshold,
        scope: row.scope,
        assignTo: row.assignTo as DiscrepancyAssignMode,
        assigneeId: row.assigneeId,
        dueHours: row.dueHours,
        lookbackDays: row.lookbackDays,
      };
    });
  }

  async saveRules(user: JwtPayload, rules: DiscrepancyTaskRuleDto[]) {
    const clubId = requireClubId(user);
    if (!Array.isArray(rules)) throw new BadRequestException('rules[] обязателен');
    for (const r of rules) {
      if (!TABS.includes(r.tab)) continue;
      const assignTo = ASSIGN_MODES.includes(r.assignTo) ? r.assignTo : 'LAST_SHIFT';
      if (assignTo === 'USER' && !r.assigneeId) {
        throw new BadRequestException(
          `${r.tab}: выберите сотрудника для авто-задач`,
        );
      }
      const data = {
        enabled: Boolean(r.enabled),
        threshold: Math.max(0, Number(r.threshold) || 0),
        scope: String(r.scope || DEFAULT_RULES[r.tab].scope),
        assignTo,
        assigneeId: assignTo === 'USER' ? r.assigneeId ?? null : null,
        dueHours: clampInt(r.dueHours, 1, 24 * 14, DEFAULT_RULES[r.tab].dueHours),
        lookbackDays: clampInt(r.lookbackDays, 1, 14, DEFAULT_RULES[r.tab].lookbackDays),
      };
      await this.prisma.discrepancyTaskRule.upsert({
        where: { clubId_tab: { clubId, tab: r.tab } },
        create: { clubId, tab: r.tab, ...data },
        update: data,
      });
    }
    return this.getRules(user);
  }

  runAutoForUser(user: JwtPayload) {
    return this.runAuto(requireClubId(user));
  }

  /** Nightly (after club sync) or «Запустить сейчас»: scans yesterday (+ lookback). */
  async runAuto(clubId: string): Promise<DiscrepancyAutoRunResult> {
    const result: DiscrepancyAutoRunResult = { created: 0, skipped: 0, byTab: {} };
    const rules = await this.prisma.discrepancyTaskRule.findMany({
      where: { clubId, enabled: true },
    });
    if (!rules.length) return result;

    const systemUser = await this.prisma.user.findFirst({
      where: {
        clubId,
        isActive: true,
        roles: { some: { role: Role.SUPER_ADMIN } },
      },
      select: { id: true },
    });
    if (!systemUser) {
      this.logger.warn(`No SUPER_ADMIN for club ${clubId} — skip discrepancy tasks`);
      return result;
    }
    const actor: JwtPayload = {
      sub: systemUser.id,
      email: '',
      clubId,
      roles: [UserRole.SUPER_ADMIN],
    };
    const staff = await this.loadStaff(clubId);
    const existing = await this.existingKeys(clubId);

    for (const rule of rules) {
      const tab = rule.tab as DiscrepancyTab;
      if (!TABS.includes(tab)) continue;
      let candidates: Candidate[] = [];
      try {
        candidates = await this.collect(actor, tab, rule);
      } catch (err) {
        this.logger.error(
          `Discrepancy auto ${tab} failed for ${clubId}`,
          err instanceof Error ? err.stack : err,
        );
        continue;
      }
      let made = 0;
      for (const c of candidates) {
        if (made >= MAX_AUTO_PER_RULE) break;
        if (existing.has(`${c.tab}|${c.itemKey}`)) {
          result.skipped += 1;
          continue;
        }
        const ids = await this.resolveAuto(clubId, rule, c, staff);
        if (!ids.length) {
          result.skipped += 1;
          continue;
        }
        const text = discrepancyTaskText(c.subject);
        const n = await this.createTasks(clubId, systemUser.id, ids, {
          tab: c.tab,
          itemKey: c.itemKey,
          fingerprint: c.fingerprint,
          date: c.date,
          title: text.title,
          description: text.description,
          dueHours: rule.dueHours,
          auto: true,
        });
        if (n > 0) {
          existing.add(`${c.tab}|${c.itemKey}`);
          made += 1;
        }
      }
      result.byTab[tab] = made;
      result.created += made;
    }
    if (result.created) {
      this.logger.log(`Club ${clubId}: discrepancy auto tasks +${result.created}`);
    }
    return result;
  }

  private async collect(
    actor: JwtPayload,
    tab: DiscrepancyTab,
    rule: { threshold: number; scope: string; lookbackDays: number },
  ): Promise<Candidate[]> {
    const days = lookbackDays(rule.lookbackDays);
    const out: Candidate[] = [];
    const min = Math.max(1, rule.threshold);

    if (tab === 'segments') {
      const data = await this.discrepancies.segmentsTab(actor, {
        from: days[days.length - 1],
        to: days[0],
      });
      const statuses =
        rule.scope === 'all'
          ? ['UNASSIGNED', 'CONFLICT', 'GUESSED']
          : ['UNASSIGNED', 'CONFLICT'];
      for (const p of data.products) {
        if (p.acked || !statuses.includes(p.status)) continue;
        if (p.salesCount < min) continue;
        out.push({
          tab,
          itemKey: p.itemKey,
          fingerprint: p.fingerprint,
          date: p.lastSoldAt ? minskDay(new Date(p.lastSoldAt)) : days[0],
          subject: {
            kind: 'product',
            name: p.name,
            status: p.status,
            salesCount: p.salesCount,
            amount: p.amount,
          },
        });
      }
      return out;
    }

    for (const day of days) {
      const period = { from: day, to: day };
      if (tab === 'sales') {
        const data = await this.discrepancies.salesTab(actor, period);
        const dayEnd = new Date(`${day}T23:59:59.999+03:00`);
        const synced = data.webkassa.lastSuccessAt
          ? new Date(data.webkassa.lastSuccessAt) >= dayEnd
          : false;
        if (!synced) continue;
        for (const d of data.days) {
          if (d.acked) continue;
          // No cheques at all → Webkassa not loaded for that day, not a real gap.
          if (Math.abs(d.kassaCash) + Math.abs(d.kassaCard) < 0.01) continue;
          const diff =
            rule.scope === 'cash'
              ? Math.abs(d.diffCash)
              : rule.scope === 'card'
                ? Math.abs(d.diffCard)
                : Math.max(Math.abs(d.diffCash), Math.abs(d.diffCard));
          if (diff <= 0.02 || diff < rule.threshold) continue;
          out.push({
            tab,
            itemKey: d.itemKey,
            fingerprint: d.fingerprint,
            date: d.date,
            subject: { kind: 'salesDay', ...d },
          });
        }
      } else if (tab === 'spa' || tab === 'pt') {
        const data = await this.discrepancies.spaPtTab(
          actor,
          tab === 'spa' ? 'SPA' : 'PT',
          period,
        );
        for (const p of data.performers) {
          const n = rule.scope === 'red' ? p.redCount : p.count;
          if (p.acked || n < min) continue;
          out.push({
            tab,
            itemKey: p.itemKey,
            fingerprint: p.fingerprint,
            date: day,
            performerUserId: p.performerUserId,
            subject: {
              kind: 'performer',
              tab,
              from: day,
              to: day,
              performerName: p.performerName,
              count: p.count,
              redCount: p.redCount,
            },
          });
        }
      } else if (tab === 'gp') {
        const data = await this.discrepancies.groupTab(actor, period);
        for (const p of data.performers) {
          for (const s of p.sessions) {
            if (s.acked || s.lateAdds < min) continue;
            out.push({
              tab,
              itemKey: s.itemKey,
              fingerprint: s.fingerprint,
              date: minskDay(new Date(s.startAt)),
              at: new Date(s.startAt),
              performerUserId: p.performerUserId,
              subject: {
                kind: 'session',
                at: s.startAt,
                title: s.title,
                performerName: p.performerName,
                lateAdds: s.lateAdds,
                bookedAtStart: s.bookedAtStart,
                confirmed: s.confirmed,
              },
            });
          }
        }
      }
    }
    return out;
  }

  // ─── Assignee resolution ────────────────────────────────────────────────

  private async resolveManual(
    clubId: string,
    value: string,
    date: string | null,
    staff: StaffRow[],
  ): Promise<string[]> {
    const [kind, ref] = value.split(':', 2);
    if (kind === 'user') {
      if (!staff.some((s) => s.id === ref)) {
        throw new BadRequestException('Сотрудник не найден или без входа в приложение');
      }
      return [ref];
    }
    if (kind === 'dept' && DEPTS.includes(ref as DiscrepancyTaskDept)) {
      return this.deptMembers(clubId, ref as DiscrepancyTaskDept, date, staff);
    }
    throw new BadRequestException('Выберите исполнителя');
  }

  private async resolveAuto(
    clubId: string,
    rule: { assignTo: string; assigneeId: string | null },
    c: Candidate,
    staff: StaffRow[],
  ): Promise<string[]> {
    const mode = rule.assignTo as DiscrepancyAssignMode;
    if (mode === 'USER' && rule.assigneeId) {
      if (staff.some((s) => s.id === rule.assigneeId)) return [rule.assigneeId];
    }
    if (mode === 'PERFORMER') {
      if (c.performerUserId && staff.some((s) => s.id === c.performerUserId)) {
        return [c.performerUserId];
      }
      const dept = discrepancyTabDept(c.tab);
      if (dept && dept !== 'ADMINS' && dept !== 'ON_SHIFT') {
        const ids = await this.deptMembers(clubId, dept, c.date, staff);
        if (ids.length) return ids;
      }
    }
    if (mode === 'ADMINS') return this.deptMembers(clubId, 'ADMINS', c.date, staff);
    if (mode === 'ON_SHIFT') {
      return this.deptMembers(clubId, 'ON_SHIFT', c.date, staff);
    }
    const shifts = await this.adminShifts(clubId, c.date, staff);
    const last = pickShift(shifts, c.at);
    if (last) return [last.userId];
    return this.deptMembers(clubId, 'ADMINS', c.date, staff);
  }

  private async suggestAssignee(q: {
    clubId: string;
    tab?: DiscrepancyTab;
    date: string;
    at?: Date;
    performerUserId?: string;
    staff: StaffRow[];
  }): Promise<Pick<DiscrepancyTaskOptions, 'suggested' | 'suggestedReason'>> {
    const performer =
      q.performerUserId && q.staff.find((s) => s.id === q.performerUserId);
    if (performer && (q.tab === 'spa' || q.tab === 'pt' || q.tab === 'gp')) {
      const who =
        q.tab === 'spa'
          ? 'специалист по списаниям'
          : q.tab === 'pt'
            ? 'тренер по списаниям'
            : 'тренер занятия';
      return { suggested: `user:${performer.id}`, suggestedReason: who };
    }

    if (q.tab === 'spa' || q.tab === 'pt' || q.tab === 'gp') {
      const dept = discrepancyTabDept(q.tab);
      if (dept) {
        const ids = await this.deptMembers(q.clubId, dept, q.date || null, q.staff);
        if (ids.length) {
          return {
            suggested: `dept:${dept}`,
            suggestedReason: q.performerUserId
              ? `${DISCREPANCY_DEPT_LABELS[dept]} — нет входа в приложение`
              : DISCREPANCY_DEPT_LABELS[dept],
          };
        }
      }
    }

    if (q.tab === 'segments' || !q.date) {
      return {
        suggested: 'dept:ADMINS',
        suggestedReason:
          q.tab === 'segments'
            ? 'настройка сегментов 1С — администраторам'
            : 'нет конкретного дня — всем администраторам',
      };
    }

    const shifts = await this.adminShifts(q.clubId, q.date, q.staff);
    const last = pickShift(shifts, q.at);
    if (!last) {
      return {
        suggested: 'dept:ADMINS',
        suggestedReason: `${ruDay(q.date)} смен администраторов не найдено`,
      };
    }
    return {
      suggested: `user:${last.userId}`,
      suggestedReason: `${q.at ? 'на смене в это время' : 'последний на смене'} ${ruDay(q.date)} до ${clubTime(last.endAt)}`,
    };
  }

  private async deptMembers(
    clubId: string,
    dept: DiscrepancyTaskDept,
    date: string | null,
    staff: StaffRow[],
  ): Promise<string[]> {
    switch (dept) {
      case 'ON_SHIFT': {
        const shifts = await this.adminShifts(
          clubId,
          date || minskDay(new Date()),
          staff,
        );
        const ids = [...new Set(shifts.map((s) => s.userId))];
        return ids.length ? ids : this.deptMembers(clubId, 'ADMINS', date, staff);
      }
      case 'ADMINS':
        return staff.filter((s) => s.roles.includes(Role.ADMIN)).map((s) => s.id);
      case 'TRAINERS_GP':
        return staff
          .filter((s) => s.roles.includes(Role.TRAINER) && s.groupPrograms)
          .map((s) => s.id);
      case 'TRAINERS_PT':
        return staff
          .filter((s) => s.roles.includes(Role.TRAINER) && s.ptTrainer)
          .map((s) => s.id);
      case 'SPECIALISTS':
        return staff
          .filter((s) => s.roles.includes(Role.SPECIALIST))
          .map((s) => s.id);
    }
  }

  /** Staff who can log in and therefore see the task. */
  private async loadStaff(clubId: string): Promise<StaffRow[]> {
    const users = await this.prisma.user.findMany({
      where: {
        clubId,
        isActive: true,
        archivedAt: null,
        loginEnabled: true,
        roles: {
          some: {
            role: { in: [Role.ADMIN, Role.MANAGER, Role.TRAINER, Role.SPECIALIST] },
          },
        },
      },
      include: { roles: true },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });
    return users.map((u) => {
      const roles = u.roles.map((r) => r.role);
      const role: DiscrepancyTaskStaff['role'] = roles.includes(Role.ADMIN)
        ? 'ADMIN'
        : roles.includes(Role.MANAGER)
          ? 'MANAGER'
          : roles.includes(Role.SPECIALIST)
            ? 'SPECIALIST'
            : 'TRAINER';
      return {
        id: u.id,
        name: `${u.lastName} ${u.firstName}`.trim() || u.email,
        role,
        roles,
        groupPrograms: Boolean(u.groupPrograms),
        ptTrainer: Boolean(u.trainerStaff || u.trainerClub),
      };
    });
  }

  private async adminShifts(
    clubId: string,
    date: string,
    staff: StaffRow[],
  ): Promise<ShiftRow[]> {
    const visible = new Set(staff.map((s) => s.id));
    const rows = await this.prisma.staffShift.findMany({
      where: {
        clubId,
        track: 'ADMIN',
        date: new Date(`${date}T00:00:00.000Z`),
      },
      select: { userId: true, startAt: true, endAt: true },
      orderBy: { endAt: 'asc' },
    });
    return rows.filter((r) => visible.has(r.userId));
  }

  private async existingKeys(clubId: string) {
    const since = new Date();
    since.setUTCDate(since.getUTCDate() - retentionDays());
    const tasks = await this.prisma.adminTask.findMany({
      where: {
        clubId,
        source: DISCREPANCY_TASK_SOURCE,
        status: { not: AdminTaskStatus.CANCELLED },
        createdAt: { gte: since },
      },
      select: { meta: true },
    });
    const keys = new Set<string>();
    for (const t of tasks) {
      const meta = discrepancyTaskMeta(t.meta);
      if (meta) keys.add(`${meta.tab}|${meta.itemKey}`);
    }
    return keys;
  }

  private async createTasks(
    clubId: string,
    createdById: string,
    assigneeIds: string[],
    data: {
      tab: DiscrepancyTab;
      itemKey: string;
      fingerprint: string;
      date: string | null;
      title: string;
      description: string | null;
      dueHours: number;
      auto: boolean;
    },
  ): Promise<number> {
    const shared = assigneeIds.length > 1;
    const groupId = shared ? `disc_${randomBytes(8).toString('hex')}` : null;
    const dueAt = new Date(Date.now() + data.dueHours * 60 * 60 * 1000);
    const meta = {
      tab: data.tab,
      itemKey: data.itemKey,
      fingerprint: data.fingerprint,
      date: data.date,
      auto: data.auto,
    };
    let created = 0;
    for (const assigneeId of assigneeIds) {
      try {
        await this.prisma.adminTask.create({
          data: {
            clubId,
            assigneeId,
            createdById,
            title: data.title,
            description: data.description,
            dueAt,
            source: DISCREPANCY_TASK_SOURCE,
            dedupeKey: data.auto
              ? `disc|${data.tab}|${data.itemKey}|${assigneeId}`
              : null,
            groupId,
            completionMode: shared ? 'SHARED' : 'INDIVIDUAL',
            meta,
          },
        });
      } catch (err) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002'
        ) {
          continue;
        }
        throw err;
      }
      created += 1;
      await this.prisma.notification.create({
        data: {
          userId: assigneeId,
          type: 'GENERAL',
          title: data.auto
            ? 'Новая задача: проверить нестыковку'
            : 'Новая задача от руководителя',
          body: data.title,
          senderId: data.auto ? null : createdById,
        },
      });
    }
    return created;
  }
}

function clampInt(v: unknown, min: number, max: number, fallback: number) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** Shift covering `at`, otherwise the one that ended last that day. */
function pickShift(shifts: ShiftRow[], at?: Date): ShiftRow | null {
  if (!shifts.length) return null;
  if (at && !Number.isNaN(at.getTime())) {
    const t = at.getTime();
    const covering = shifts.filter(
      (s) => s.startAt.getTime() <= t && s.endAt.getTime() >= t,
    );
    if (covering.length) return covering[covering.length - 1];
  }
  return shifts.reduce((a, b) => (b.endAt > a.endAt ? b : a));
}

/** Yesterday first, then further back. */
function lookbackDays(n: number): string[] {
  const out: string[] = [];
  for (let i = 1; i <= Math.max(1, n); i += 1) {
    out.push(minskDay(new Date(Date.now() - i * 86400000)));
  }
  return out;
}

function ruDay(iso: string) {
  return `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;
}

function clubTime(d: Date) {
  return new Date(d.getTime() + 3 * 60 * 60 * 1000).toISOString().slice(11, 16);
}
