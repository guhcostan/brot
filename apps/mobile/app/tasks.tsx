import type { Bot, Task } from '@brot/protocol';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, SectionList, StyleSheet, View } from 'react-native';
import Animated, { LinearTransition, useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BotFace } from '../src/avatar/BotFace';
import { describeError, usePaired } from '../src/core/BrotProvider';
import { shortTime } from '../src/format';
import { t } from '../src/i18n';
import { applyTaskEvent, isActiveTask, taskColumns, taskStatusLabel } from '../src/state/tasks';
import { riseIn } from '../src/theme/motion';
import { useTheme } from '../src/theme/ThemeProvider';
import { Button } from '../src/ui/Button';
import { Header, Screen, SectionLabel } from '../src/ui/Screen';
import { Text } from '../src/ui/Text';
import { useLocale } from '../src/i18n/useLocale';

type Filter = 'active' | 'all';

function useTasks() {
  const paired = usePaired();
  const client = paired?.client;
  const subscribe = paired?.subscribe;
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  const load = useCallback(async () => {
    if (!client) return;
    try {
      setTasks(await client.listTasks());
      setError(undefined);
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    void load();
    if (!subscribe) return;
    return subscribe((event) => {
      if (event.type !== 'task.created' && event.type !== 'task.updated') return;
      setTasks((current) => applyTaskEvent(current, event));
      if (event.type === 'task.updated' && event.task.status === 'done') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    });
  }, [load, subscribe]);

  return { tasks, loading, error, reload: load };
}

function FilterTabs({ value, onChange, counts }: { value: Filter; onChange: (next: Filter) => void; counts: Record<Filter, number> }): ReactElement {
  const theme = useTheme();
  const options: Filter[] = ['active', 'all'];
  return (
    <View style={[styles.row, { paddingHorizontal: theme.space[4], gap: theme.space[4], borderBottomColor: theme.color.line }, styles.tabs]} accessibilityRole="tablist">
      {options.map((option) => {
        const selected = option === value;
        const label = option === 'active' ? t('tasks.filterActive') : t('tasks.filterAll');
        return (
          <Pressable
            key={option}
            onPress={() => onChange(option)}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={`${label}, ${counts[option]}`}
            style={[styles.tab, { borderBottomColor: selected ? theme.color.ink : 'transparent' }]}
          >
            <Text variant="label" tone={selected ? 'ink' : 'ink2'}>
              {label}{' '}
              <Text variant="label" tone="ink3" numeric>
                {counts[option]}
              </Text>
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function TaskRow({ task, bots }: { task: Task; bots: Bot[] }): ReactElement {
  const theme = useTheme();
  const reduced = useReducedMotion();
  const assignee = bots.find((bot) => bot.id === task.assigneeBotId);
  const creator = task.createdByBotId ? bots.find((bot) => bot.id === task.createdByBotId) : undefined;
  const name = assignee?.name ?? t('common.aBot');
  const from = task.createdByUser ? t('tasks.fromYou') : t('tasks.fromBot', { name: creator?.name ?? t('common.aBot') });
  const mood = task.status === 'in_progress' ? 'thinking' : task.status === 'blocked' ? 'approval' : task.status === 'failed' ? 'error' : task.status === 'done' ? 'success' : 'idle';
  const open = () => {
    const threadId = task.workThreadId ?? task.threadId;
    router.push({ pathname: '/thread/[botId]', params: { botId: task.assigneeBotId, threadId } });
  };
  return (
    <Animated.View entering={riseIn(reduced, 6)} layout={reduced ? undefined : LinearTransition.duration(theme.motion.base)} style={{ marginHorizontal: theme.space[4], marginBottom: theme.space[2] }}>
      <Pressable
        onPress={open}
        accessibilityRole="button"
        accessibilityLabel={t('tasks.label', { title: task.title, status: taskStatusLabel(task.status), name })}
        accessibilityHint={t('tasks.openWork', { name })}
        style={({ pressed }) => [
          styles.card,
          {
            padding: theme.space[3],
            gap: theme.space[3],
            borderRadius: theme.radius.lg,
            borderColor: theme.color.line,
            backgroundColor: pressed ? theme.color.surface2 : theme.color.surface,
            marginLeft: Math.min(task.depth, 3) * theme.space[3],
          },
        ]}
      >
        <BotFace bot={assignee} botId={task.assigneeBotId} size="md" mood={mood} />
        <View style={[styles.flex, { gap: 2 }]}>
          <Text variant="bodyStrong" numberOfLines={2}>
            {task.title}
          </Text>
          <Text variant="meta" tone="ink2" numberOfLines={1}>
            {name} · {from}
            {task.depth > 0 ? ` · ${t('tasks.depth', { depth: task.depth })}` : ''}
          </Text>
          {task.result ? (
            <Text variant="small" tone="ink2" numberOfLines={2}>
              {task.result}
            </Text>
          ) : null}
        </View>
        <Text variant="caption" tone="ink3" numeric>
          {shortTime(task.updatedAt)}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

export default function TasksScreen(): ReactElement | null {
  const locale = useLocale();
  const paired = usePaired();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { tasks, loading, error, reload } = useTasks();
  const [filter, setFilter] = useState<Filter>('active');
  const [refreshing, setRefreshing] = useState(false);

  const sections = useMemo(
    () => taskColumns(tasks, filter).map((column) => ({ key: column.status, title: `${taskStatusLabel(column.status)} · ${column.tasks.length}`, data: column.tasks })),
    [tasks, filter],
  );
  const counts = { active: tasks.filter(isActiveTask).length, all: tasks.length };

  if (!paired) return null;

  const empty = loading ? (
    <View style={styles.centered}>
      <ActivityIndicator color={theme.color.ink3} />
    </View>
  ) : error ? (
    <View style={[styles.centered, { gap: theme.space[4], padding: theme.space[6] }]}>
      <Text tone="ink2" style={styles.textCenter}>
        {error}
      </Text>
      <Button label={t('common.tryAgain')} variant="secondary" onPress={() => void reload()} />
    </View>
  ) : (
    <View style={[styles.centered, { gap: theme.space[4], padding: theme.space[6] }]}>
      <BotFace botId="tasks-empty" bot={{ id: 'tasks-empty', avatar: 'preguica:gray' }} mood="sleeping" size="xl" />
      <Text tone="ink2" style={styles.textCenter}>
        {t('tasks.empty')}
      </Text>
    </View>
  );

  return (
    <Screen>
      <Header title={t('tasks.title')} onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
      <FilterTabs value={filter} onChange={setFilter} counts={counts} />
      <SectionList
        sections={sections}
        keyExtractor={(task) => task.id}
        renderSectionHeader={({ section }) => (
          <View style={{ backgroundColor: theme.color.bg }}>
            <SectionLabel>{section.title}</SectionLabel>
          </View>
        )}
        renderItem={({ item }) => <TaskRow task={item} bots={paired.inbox.bots} />}
        ListEmptyComponent={empty}
        stickySectionHeadersEnabled={false}
        extraData={locale}
        contentContainerStyle={[{ paddingBottom: insets.bottom + theme.space[6] }, sections.length === 0 ? styles.grow : null]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void reload().finally(() => setRefreshing(false));
            }}
            tintColor={theme.color.ink3}
            colors={[theme.color.ink]}
          />
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  grow: { flexGrow: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
  tabs: { borderBottomWidth: StyleSheet.hairlineWidth },
  tab: { minHeight: 44, justifyContent: 'center', borderBottomWidth: 2 },
  card: { flexDirection: 'row', alignItems: 'flex-start', borderWidth: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  textCenter: { textAlign: 'center' },
});
