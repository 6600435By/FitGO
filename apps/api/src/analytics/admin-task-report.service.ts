import { Injectable } from '@nestjs/common';
import type {
  AdminTaskWorkMatrixCell,
  AdminTaskWorkPersonRow,
  AdminTaskWorkPersonTask,
  AdminTaskWorkReport,
  AdminTaskWorkTopic,
  AdminTaskWorkTopicRow,
  AnalyticMetric,
} from '@fitgo/shared-types';
import {
  AdminTaskCompletionMode,
  AdminTaskEventKind,
  AdminTaskStatus as PrismaAdminTaskStatus,
  Role,
} from '@prisma/client';
import { adminTaskTopic } from '../admin/task-topic';
import type { JwtPayload } from '../auth/jwt.strategy';
import { requireClubId } from '../auth/require-club-id';
import { PrismaService } from '../prisma/prisma.service';
import {
  addDaysIso,
  assertPeriod,
  daysInclusive,
  metric,
  rangeBounds,
} from './analytics-period';
import {
  ageBucketDays,
  closeHours,
  collapseSharedGroups,
  computeRating,
  isOnTime,
  isOverdueOpen,
  median,
  onTimePct,
  RATING_FORMULA,
  TOPIC_LABELS,
  TOPIC_ORDER,
  type CreditTaskInput,
} from './admin-task-report.rules';

type DbTask = {
  id: string;
  title: string;
  status: PrismaAdminTaskStatus;
  source: string;
  dueAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  assigneeId: string | null;
  groupId: string | null;
  completionMode: AdminTaskCompletionMode;
  stage: string | null;
  meta: unknown;
  reworkCount: number;
};

@Injectable()
export class AdminTaskReportService {
  constructor(private readonly prisma: PrismaService) {}

  async getReport(
    user: JwtPayload,
    params: { from: string; to: string },
  ): Promise<AdminTaskWorkReport> {
    assertPeriod(params.from, params.to);
    const clubId = requireClubId(user);
    const { start, end } = rangeBounds(params.from, params.to);
    const len = daysInclusive(params.from, params.to);
    const compareTo = addDaysIso(params.from, -1);
    const compareFrom = addDaysIso(compareTo, -(len - 1));
    const prev = rangeBounds(compareFrom, compareTo);
    const now = new Date();

    const [admins, tasks, prevTasks] = await Promise.all([
      this.prisma.user.findMany({
        where: {
          clubId,
          archivedAt: null,
          roles: { some: { role: Role.ADMIN } },
        },
        select: { id: true, firstName: true, lastName: true },
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      }),
      this.loadTasks(clubId, start, end),
      this.loadTasks(clubId, prev.start, prev.end),
    ]);

    const closerMap = await this.loadClosers(tasks);
    const claimAtMap = await this.loadFirstClaimAt(tasks.map((t) => t.id));
    const reworkIds = await this.loadReworkedTaskIds(
      tasks.map((t) => t.id),
      start,
      end,
    );

    const current = this.buildPeriodStats(tasks, start, end, now, closerMap);
    const previous = this.buildPeriodStats(
      prevTasks,
      prev.start,
      prev.end,
      now,
      new Map(),
    );

    const snapshot = this.buildSnapshot(tasks, now);
    const flow = {
      created: metric(current.created, previous.created, { unit: 'count' }),
      closed: metric(current.closed, previous.closed, { unit: 'count' }),
      onTimePct: metric(
        current.onTimePct ?? 0,
        previous.onTimePct,
        {
          unit: 'percent',
          unavailable: current.onTimePct == null,
        },
      ) as AnalyticMetric,
      medianCloseHours: metric(
        current.medianCloseHours ?? 0,
        previous.medianCloseHours,
        {
          unit: 'hours',
          unavailable: current.medianCloseHours == null,
        },
      ) as AnalyticMetric,
    };
    if (current.onTimePct == null) {
      flow.onTimePct = {
        ...flow.onTimePct,
        value: 0,
        unavailable: true,
        compareValue: null,
        deltaPct: null,
      };
    }
    if (current.medianCloseHours == null) {
      flow.medianCloseHours = {
        ...flow.medianCloseHours,
        value: 0,
        unavailable: true,
        compareValue: null,
        deltaPct: null,
      };
    }

    const byTopic = this.buildByTopic(tasks, start, end, now, closerMap);
    const { byPerson, unassigned, matrix } = this.buildByPerson(
      admins,
      tasks,
      start,
      end,
      now,
      closerMap,
      claimAtMap,
      reworkIds,
    );

    return {
      from: params.from,
      to: params.to,
      snapshot,
      flow,
      byTopic,
      byPerson,
      matrix,
      unassigned,
      ratingFormula: RATING_FORMULA,
    };
  }

  async exportXlsx(
    user: JwtPayload,
    params: { from: string; to: string },
  ): Promise<Buffer> {
    const report = await this.getReport(user, params);
    const ExcelJS = await import('exceljs');
    const wb = new ExcelJS.Workbook();
    wb.creator = 'FitGO';

    const summary = wb.addWorksheet('Сводка');
    summary.addRow(['Период', `${report.from} — ${report.to}`]);
    summary.addRow([]);
    summary.addRow(['Сейчас']);
    summary.addRow(['В работе', report.snapshot.open]);
    summary.addRow(['Просрочено', report.snapshot.overdue]);
    summary.addRow(['Без исполнителя', report.snapshot.unassigned]);
    summary.addRow(['Возраст 0–1 дн.', report.snapshot.age.d0_1]);
    summary.addRow(['Возраст 2–3 дн.', report.snapshot.age.d2_3]);
    summary.addRow(['Возраст 4–7 дн.', report.snapshot.age.d4_7]);
    summary.addRow(['Возраст 8+ дн.', report.snapshot.age.d8plus]);
    summary.addRow([]);
    summary.addRow(['За период']);
    summary.addRow([
      'Создано',
      report.flow.created.value,
      deltaLabel(report.flow.created),
    ]);
    summary.addRow([
      'Закрыто',
      report.flow.closed.value,
      deltaLabel(report.flow.closed),
    ]);
    summary.addRow([
      'В срок %',
      report.flow.onTimePct.unavailable
        ? '—'
        : report.flow.onTimePct.value,
      deltaLabel(report.flow.onTimePct),
    ]);
    summary.addRow([
      'Медиана часов',
      report.flow.medianCloseHours.unavailable
        ? '—'
        : report.flow.medianCloseHours.value,
      deltaLabel(report.flow.medianCloseHours),
    ]);
    summary.addRow([]);
    summary.addRow(['Формула рейтинга', report.ratingFormula]);

    const topics = wb.addWorksheet('Виды');
    topics.addRow([
      'Вид',
      'Создано',
      'Закрыто',
      'В работе',
      'Просрочено',
      'В срок %',
    ]);
    topics.views = [{ state: 'frozen', ySplit: 1 }];
    for (const row of report.byTopic) {
      topics.addRow([
        row.label,
        row.created,
        row.closed,
        row.open,
        row.overdue,
        row.onTimePct ?? '—',
      ]);
    }

    const people = wb.addWorksheet('Люди');
    people.addRow([
      'ФИО',
      'Сейчас в работе',
      'Просрочено',
      'Закрыто',
      'В срок %',
      'Медиана ч',
      'Продлил',
      'Потерял',
      'Рейтинг',
      'Место',
    ]);
    people.views = [{ state: 'frozen', ySplit: 1 }];
    if (report.unassigned.openNow > 0) {
      people.addRow([
        'Очередь (без исполнителя)',
        report.unassigned.openNow,
        report.unassigned.overdueNow,
        '',
        '',
        '',
        '',
        '',
        '',
        '',
      ]);
    }
    for (const row of report.byPerson) {
      people.addRow([
        row.name,
        row.openNow,
        row.overdueNow,
        row.closed,
        row.onTimePct ?? '—',
        row.medianCloseHours ?? '—',
        row.renewalRenewed,
        row.renewalLost,
        row.rating ?? 'мало данных',
        row.rank ?? '—',
      ]);
    }

    const buf = await wb.xlsx.writeBuffer();
    return Buffer.from(buf);
  }

  private async loadTasks(clubId: string, start: Date, end: Date) {
    return this.prisma.adminTask.findMany({
      where: {
        clubId,
        OR: [
          {
            status: {
              in: [PrismaAdminTaskStatus.OPEN, PrismaAdminTaskStatus.IN_PROGRESS],
            },
          },
          { createdAt: { gte: start, lte: end } },
          { completedAt: { gte: start, lte: end } },
        ],
      },
      select: {
        id: true,
        title: true,
        status: true,
        source: true,
        dueAt: true,
        completedAt: true,
        createdAt: true,
        assigneeId: true,
        groupId: true,
        completionMode: true,
        stage: true,
        meta: true,
        reworkCount: true,
      },
    });
  }

  /**
   * Human closer only. Auto closes («Авто:…») omitted from map → no person credit.
   * SHARED: prefer «Выполнил…общее задание»; else first non-auto actor; else assignee.
   */
  private async loadClosers(
    tasks: DbTask[],
  ): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    const done = tasks.filter((t) => t.status === PrismaAdminTaskStatus.DONE);
    if (!done.length) return map;
    const doneIds = done.map((t) => t.id);
    const events = await this.prisma.adminTaskEvent.findMany({
      where: { taskId: { in: doneIds }, actorId: { not: null } },
      orderBy: { createdAt: 'asc' },
      select: { taskId: true, actorId: true, comment: true },
    });
    const autoClosed = new Set<string>();
    for (const e of events) {
      if (!e.actorId) continue;
      if (e.comment?.startsWith('Авто:')) {
        autoClosed.add(e.taskId);
        continue;
      }
      const sharedClose =
        e.comment?.includes('общее задание') ||
        e.comment?.includes('Выполнил');
      if (sharedClose) {
        map.set(e.taskId, e.actorId);
      } else if (!map.has(e.taskId)) {
        map.set(e.taskId, e.actorId);
      }
    }
    for (const id of autoClosed) {
      map.delete(id);
    }
    for (const t of done) {
      if (autoClosed.has(t.id)) continue;
      if (map.has(t.id)) continue;
      if (t.assigneeId) map.set(t.id, t.assigneeId);
    }
    return map;
  }

  private async loadFirstClaimAt(
    taskIds: string[],
  ): Promise<Map<string, Date>> {
    const map = new Map<string, Date>();
    if (!taskIds.length) return map;
    const events = await this.prisma.adminTaskEvent.findMany({
      where: {
        taskId: { in: taskIds },
        OR: [
          { kind: AdminTaskEventKind.CLAIM },
          { kind: AdminTaskEventKind.ASSIGN },
          { comment: { contains: 'Взял' } },
          { comment: { contains: 'Назначен' } },
        ],
      },
      orderBy: { createdAt: 'asc' },
      select: { taskId: true, createdAt: true },
    });
    for (const e of events) {
      if (!map.has(e.taskId)) map.set(e.taskId, e.createdAt);
    }
    return map;
  }

  private async loadReworkedTaskIds(
    taskIds: string[],
    start: Date,
    end: Date,
  ): Promise<Set<string>> {
    if (!taskIds.length) return new Set();
    const events = await this.prisma.adminTaskEvent.findMany({
      where: {
        taskId: { in: taskIds },
        kind: AdminTaskEventKind.REWORK,
        createdAt: { gte: start, lte: end },
      },
      select: { taskId: true },
    });
    return new Set(events.map((e) => e.taskId));
  }

  private topicOf(task: DbTask): AdminTaskWorkTopic {
    const meta = task.meta as { clientName?: string } | null;
    return adminTaskTopic({
      source: task.source,
      title: task.title,
      clientName: meta?.clientName,
    });
  }

  private toCreditInput(
    task: DbTask,
    closerMap: Map<string, string>,
  ): CreditTaskInput {
    const isDone = task.status === PrismaAdminTaskStatus.DONE;
    const humanCloser = closerMap.get(task.id) ?? null;
    // DONE without closerMap entry = system auto-close → no person credit
    const noHumanCredit = isDone && !closerMap.has(task.id);
    return {
      id: task.id,
      groupId: task.groupId,
      completionMode:
        task.completionMode === AdminTaskCompletionMode.SHARED
          ? 'SHARED'
          : 'INDIVIDUAL',
      assigneeId: noHumanCredit ? null : task.assigneeId,
      status: task.status,
      completedAt: task.completedAt,
      closerActorId: humanCloser,
    };
  }

  private buildSnapshot(tasks: DbTask[], now: Date) {
    const openTasks = tasks.filter(
      (t) =>
        t.status === PrismaAdminTaskStatus.OPEN ||
        t.status === PrismaAdminTaskStatus.IN_PROGRESS,
    );
    // Deduplicate SHARED open groups for snapshot counts
    const collapse = collapseSharedGroups(
      openTasks.map((t) => this.toCreditInput(t, new Map())),
    );
    const repIds = new Set([...collapse.values()].map((g) => g.taskId));
    const reps = openTasks.filter((t) => repIds.has(t.id));

    const age = { d0_1: 0, d2_3: 0, d4_7: 0, d8plus: 0 };
    let overdue = 0;
    let unassigned = 0;
    for (const t of reps) {
      age[ageBucketDays(t.createdAt, now)]++;
      if (isOverdueOpen(t.status, t.dueAt, now)) overdue++;
      if (!t.assigneeId) unassigned++;
    }
    return {
      open: reps.length,
      overdue,
      unassigned,
      age,
    };
  }

  private buildPeriodStats(
    tasks: DbTask[],
    start: Date,
    end: Date,
    _now: Date,
    closerMap: Map<string, string>,
  ) {
    const collapse = collapseSharedGroups(
      tasks.map((t) => this.toCreditInput(t, closerMap)),
    );
    const byId = new Map(tasks.map((t) => [t.id, t]));

    let created = 0;
    let closed = 0;
    let onTimeCount = 0;
    let withDue = 0;
    const closeHourList: number[] = [];
    const countedCreated = new Set<string>();

    for (const t of tasks) {
      if (t.createdAt < start || t.createdAt > end) continue;
      const isShared =
        t.groupId && t.completionMode === AdminTaskCompletionMode.SHARED;
      if (isShared) {
        const key = `c:${t.groupId}`;
        if (countedCreated.has(key)) continue;
        const members = tasks.filter((x) => x.groupId === t.groupId);
        const earliest = members.reduce((a, b) =>
          a.createdAt <= b.createdAt ? a : b,
        );
        if (earliest.id !== t.id) continue;
        countedCreated.add(key);
        created++;
      } else {
        created++;
      }
    }

    for (const g of collapse.values()) {
      const t = byId.get(g.taskId);
      if (!t) continue;
      if (
        t.status === PrismaAdminTaskStatus.DONE &&
        t.completedAt &&
        t.completedAt >= start &&
        t.completedAt <= end
      ) {
        closed++;
        const ot = isOnTime(t.dueAt, t.completedAt);
        if (ot !== null) {
          withDue++;
          if (ot) onTimeCount++;
        }
        closeHourList.push(closeHours(t.createdAt, t.completedAt));
      }
    }

    const med = median(closeHourList);
    return {
      created,
      closed,
      onTimePct: onTimePct(onTimeCount, withDue),
      medianCloseHours:
        med != null ? Math.round(med * 10) / 10 : null,
    };
  }

  private buildByTopic(
    tasks: DbTask[],
    start: Date,
    end: Date,
    now: Date,
    closerMap: Map<string, string>,
  ): AdminTaskWorkTopicRow[] {
    const collapse = collapseSharedGroups(
      tasks.map((t) => this.toCreditInput(t, closerMap)),
    );
    const byId = new Map(tasks.map((t) => [t.id, t]));
    const repTasks = [...collapse.values()]
      .map((g) => byId.get(g.taskId))
      .filter((t): t is DbTask => Boolean(t));

    const rows = new Map<
      AdminTaskWorkTopic,
      {
        created: number;
        closed: number;
        open: number;
        overdue: number;
        onTime: number;
        withDue: number;
      }
    >();
    for (const topic of TOPIC_ORDER) {
      rows.set(topic, {
        created: 0,
        closed: 0,
        open: 0,
        overdue: 0,
        onTime: 0,
        withDue: 0,
      });
    }

    // Created: per logical task (earliest in SHARED group)
    const createdKeys = new Set<string>();
    for (const t of tasks) {
      if (t.createdAt < start || t.createdAt > end) continue;
      const key =
        t.groupId && t.completionMode === AdminTaskCompletionMode.SHARED
          ? `g:${t.groupId}`
          : t.id;
      if (createdKeys.has(key)) continue;
      if (
        t.groupId &&
        t.completionMode === AdminTaskCompletionMode.SHARED
      ) {
        const members = tasks.filter((x) => x.groupId === t.groupId);
        const earliest = members.reduce((a, b) =>
          a.createdAt <= b.createdAt ? a : b,
        );
        if (earliest.id !== t.id) continue;
      }
      createdKeys.add(key);
      const topic = this.topicOf(t);
      const row = rows.get(topic)!;
      row.created++;
    }

    for (const t of repTasks) {
      const topic = this.topicOf(t);
      const row = rows.get(topic)!;
      const open =
        t.status === PrismaAdminTaskStatus.OPEN ||
        t.status === PrismaAdminTaskStatus.IN_PROGRESS;
      if (open) {
        row.open++;
        if (isOverdueOpen(t.status, t.dueAt, now)) row.overdue++;
      }
      if (
        t.status === PrismaAdminTaskStatus.DONE &&
        t.completedAt &&
        t.completedAt >= start &&
        t.completedAt <= end
      ) {
        row.closed++;
        const ot = isOnTime(t.dueAt, t.completedAt);
        if (ot !== null) {
          row.withDue++;
          if (ot) row.onTime++;
        }
      }
    }

    return TOPIC_ORDER.map((topic) => {
      const r = rows.get(topic)!;
      return {
        topic,
        label: TOPIC_LABELS[topic],
        created: r.created,
        closed: r.closed,
        open: r.open,
        overdue: r.overdue,
        onTimePct: onTimePct(r.onTime, r.withDue),
      };
    });
  }

  private buildByPerson(
    admins: Array<{ id: string; firstName: string; lastName: string }>,
    tasks: DbTask[],
    start: Date,
    end: Date,
    now: Date,
    closerMap: Map<string, string>,
    claimAtMap: Map<string, Date>,
    reworkIds: Set<string>,
  ): {
    byPerson: AdminTaskWorkPersonRow[];
    unassigned: AdminTaskWorkReport['unassigned'];
    matrix: AdminTaskWorkMatrixCell[];
  } {
    const collapse = collapseSharedGroups(
      tasks.map((t) => this.toCreditInput(t, closerMap)),
    );
    const byId = new Map(tasks.map((t) => [t.id, t]));
    type TopicAcc = {
      closed: number;
      onTime: number;
      withDue: number;
      closeHours: number[];
      rework: number;
    };
    type Acc = {
      openNow: number;
      overdueNow: number;
      closed: number;
      onTime: number;
      withDue: number;
      closeHours: number[];
      claimHours: number[];
      renewalRenewed: number;
      renewalLost: number;
      reworkCount: number;
      cancelled: number;
      openTasks: AdminTaskWorkPersonTask[];
      closedTasks: AdminTaskWorkPersonTask[];
      byTopic: Map<AdminTaskWorkTopic, TopicAcc>;
    };
    const emptyTopic = (): TopicAcc => ({
      closed: 0,
      onTime: 0,
      withDue: 0,
      closeHours: [],
      rework: 0,
    });
    const empty = (): Acc => ({
      openNow: 0,
      overdueNow: 0,
      closed: 0,
      onTime: 0,
      withDue: 0,
      closeHours: [],
      claimHours: [],
      renewalRenewed: 0,
      renewalLost: 0,
      reworkCount: 0,
      cancelled: 0,
      openTasks: [],
      closedTasks: [],
      byTopic: new Map(),
    });

    const byUser = new Map<string, Acc>();
    for (const a of admins) byUser.set(a.id, empty());
    const unassignedAcc = empty();

    const mapPersonTask = (t: DbTask, overdue: boolean): AdminTaskWorkPersonTask => ({
      id: t.id,
      title: t.title,
      topic: this.topicOf(t),
      status: t.status as AdminTaskWorkPersonTask['status'],
      dueAt: t.dueAt?.toISOString() ?? null,
      completedAt: t.completedAt?.toISOString() ?? null,
      createdAt: t.createdAt.toISOString(),
      overdue,
    });

    const ensureTopic = (acc: Acc, topic: AdminTaskWorkTopic): TopicAcc => {
      let row = acc.byTopic.get(topic);
      if (!row) {
        row = emptyTopic();
        acc.byTopic.set(topic, row);
      }
      return row;
    };

    // Open now — by current assignee (not collapsed credit)
    const openCollapse = collapseSharedGroups(
      tasks
        .filter(
          (t) =>
            t.status === PrismaAdminTaskStatus.OPEN ||
            t.status === PrismaAdminTaskStatus.IN_PROGRESS,
        )
        .map((t) => this.toCreditInput(t, new Map())),
    );
    for (const g of openCollapse.values()) {
      const t = byId.get(g.taskId);
      if (!t) continue;
      const overdue = isOverdueOpen(t.status, t.dueAt, now);
      const item = mapPersonTask(t, overdue);
      if (!t.assigneeId) {
        unassignedAcc.openNow++;
        if (overdue) unassignedAcc.overdueNow++;
        unassignedAcc.openTasks.push(item);
        continue;
      }
      let acc = byUser.get(t.assigneeId);
      if (!acc) {
        acc = empty();
        byUser.set(t.assigneeId, acc);
      }
      acc.openNow++;
      if (overdue) acc.overdueNow++;
      acc.openTasks.push(item);
    }

    // Closed in period — by human credit only (closerMap)
    for (const g of collapse.values()) {
      const t = byId.get(g.taskId);
      if (!t) continue;
      if (
        t.status === PrismaAdminTaskStatus.CANCELLED &&
        t.completedAt &&
        t.completedAt >= start &&
        t.completedAt <= end
      ) {
        const cancelId = t.assigneeId;
        if (cancelId) {
          let acc = byUser.get(cancelId);
          if (!acc) {
            acc = empty();
            byUser.set(cancelId, acc);
          }
          acc.cancelled++;
        }
        continue;
      }
      if (
        t.status !== PrismaAdminTaskStatus.DONE ||
        !t.completedAt ||
        t.completedAt < start ||
        t.completedAt > end
      ) {
        continue;
      }
      const creditId = g.creditUserId;
      if (!creditId) continue;
      let acc = byUser.get(creditId);
      if (!acc) {
        acc = empty();
        byUser.set(creditId, acc);
      }
      acc.closed++;
      const ot = isOnTime(t.dueAt, t.completedAt);
      if (ot !== null) {
        acc.withDue++;
        if (ot) acc.onTime++;
      }
      acc.closeHours.push(closeHours(t.createdAt, t.completedAt));
      const claimAt = claimAtMap.get(t.id);
      if (claimAt && claimAt >= t.createdAt) {
        acc.claimHours.push(closeHours(t.createdAt, claimAt));
      }
      if (reworkIds.has(t.id) || t.reworkCount > 0) {
        // Count rework if event in period OR task was reworked at least once and closed in period
        if (reworkIds.has(t.id)) acc.reworkCount++;
      }
      const topic = this.topicOf(t);
      const topicAcc = ensureTopic(acc, topic);
      topicAcc.closed++;
      if (ot !== null) {
        topicAcc.withDue++;
        if (ot) topicAcc.onTime++;
      }
      topicAcc.closeHours.push(closeHours(t.createdAt, t.completedAt));
      if (reworkIds.has(t.id)) topicAcc.rework++;

      const overdueDone = Boolean(
        t.dueAt && t.completedAt.getTime() > t.dueAt.getTime(),
      );
      acc.closedTasks.push(mapPersonTask(t, overdueDone));
      if (t.source === 'MEMBERSHIP_EXPIRING') {
        if (t.stage === 'RENEWED') acc.renewalRenewed++;
        if (t.stage === 'LOST') acc.renewalLost++;
      }
    }

    const closedCounts = admins
      .map((a) => byUser.get(a.id)?.closed ?? 0)
      .filter((c) => c > 0);
    const teamMedian = median(closedCounts) ?? 0;

    const rows: AdminTaskWorkPersonRow[] = admins.map((a) => {
      const acc = byUser.get(a.id) ?? empty();
      const pct = onTimePct(acc.onTime, acc.withDue);
      const med = median(acc.closeHours);
      const claimMed = median(acc.claimHours);
      const reworkPct =
        acc.closed > 0
          ? Math.round((acc.reworkCount / acc.closed) * 100)
          : null;
      const rating = computeRating(acc.closed, pct, teamMedian, reworkPct);
      return {
        userId: a.id,
        name: `${a.firstName} ${a.lastName}`.trim(),
        openNow: acc.openNow,
        overdueNow: acc.overdueNow,
        closed: acc.closed,
        onTimePct: pct,
        medianCloseHours: med != null ? Math.round(med * 10) / 10 : null,
        medianClaimHours:
          claimMed != null ? Math.round(claimMed * 10) / 10 : null,
        renewalRenewed: acc.renewalRenewed,
        renewalLost: acc.renewalLost,
        reworkCount: acc.reworkCount,
        reworkPct,
        cancelled: acc.cancelled,
        rating,
        rank: null,
        openTasks: acc.openTasks.slice(0, 50),
        closedTasks: acc.closedTasks
          .sort(
            (x, y) =>
              (y.completedAt ?? '').localeCompare(x.completedAt ?? ''),
          )
          .slice(0, 50),
      };
    });

    // Sort by rating desc, then closed desc; assign ranks only when rated
    rows.sort((a, b) => {
      if (a.rating != null && b.rating != null) {
        if (b.rating !== a.rating) return b.rating - a.rating;
      } else if (a.rating != null) return -1;
      else if (b.rating != null) return 1;
      return b.closed - a.closed;
    });
    let place = 0;
    for (const r of rows) {
      if (r.rating != null) {
        place++;
        r.rank = place;
      }
    }

    const matrix: AdminTaskWorkMatrixCell[] = [];
    for (const a of admins) {
      const acc = byUser.get(a.id) ?? empty();
      for (const topic of TOPIC_ORDER) {
        const t = acc.byTopic.get(topic) ?? emptyTopic();
        if (t.closed === 0) continue;
        const med = median(t.closeHours);
        matrix.push({
          userId: a.id,
          topic,
          closed: t.closed,
          onTimePct: onTimePct(t.onTime, t.withDue),
          medianCloseHours: med != null ? Math.round(med * 10) / 10 : null,
          reworkPct:
            t.closed > 0 ? Math.round((t.rework / t.closed) * 100) : null,
        });
      }
    }

    return {
      byPerson: rows,
      matrix,
      unassigned: {
        openNow: unassignedAcc.openNow,
        overdueNow: unassignedAcc.overdueNow,
        tasks: unassignedAcc.openTasks.slice(0, 50),
      },
    };
  }
}

function deltaLabel(m: AnalyticMetric): string {
  if (m.unavailable || m.deltaPct == null) return '';
  const sign = m.deltaPct > 0 ? '+' : '';
  return `${sign}${m.deltaPct}%`;
}
