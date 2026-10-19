import { useState } from 'react';
import type { SmartPlaylistRule, SmartPlaylistRules, SmartPlaylistRuleGroup, SmartPlaylistSort } from '../../../../types';
import {
  defaultOperatorForType,
  defaultRule,
  defaultSort,
  defaultValueForType,
  ensureDefaultSort,
  getFieldType,
} from './smartPlaylistModel.js';

export interface SmartPlaylistRulesState {
  group: SmartPlaylistRuleGroup;
  sort: SmartPlaylistSort[];
  limit: string;
  activeKey: 'all' | 'any';
  rulesList: SmartPlaylistRule[];
  update: (nextGroup: SmartPlaylistRuleGroup, nextSort: SmartPlaylistSort[], nextLimit: string) => void;
  updateRule: (index: number, patch: Partial<SmartPlaylistRule>) => void;
  updateRuleField: (index: number, field: string) => void;
  removeRule: (index: number) => void;
  addRule: () => void;
  moveRule: (index: number, direction: -1 | 1) => void;
  toggleMatchType: () => void;
  addSort: () => void;
  removeSort: (index: number) => void;
  moveSort: (index: number, direction: -1 | 1) => void;
  updateSortField: (index: number, field: string) => void;
  updateSortDirection: (index: number, direction: 'asc' | 'desc' | 'random') => void;
}

export function useSmartPlaylistRules(
  initialRules: SmartPlaylistRules | undefined,
  onChange: (rules: SmartPlaylistRules) => void,
): SmartPlaylistRulesState {
  const [group, setGroup] = useState<SmartPlaylistRuleGroup>(initialRules?.rules ?? { all: [defaultRule()] });
  const [sort, setSort] = useState<SmartPlaylistSort[]>(() => ensureDefaultSort(initialRules?.sort));
  const [limit, setLimit] = useState<string>(initialRules?.limit?.toString() ?? '');

  const update = (nextGroup: SmartPlaylistRuleGroup, nextSort: SmartPlaylistSort[], nextLimit: string) => {
    setGroup(nextGroup);
    setSort(nextSort);
    setLimit(nextLimit);
    const rules: SmartPlaylistRules = { rules: nextGroup, sort: nextSort };
    const parsedLimit = parseInt(nextLimit, 10);
    if (!Number.isNaN(parsedLimit) && parsedLimit > 0) {
      rules.limit = parsedLimit;
    }
    onChange(rules);
  };

  const activeKey: 'all' | 'any' = group.all && group.all.length > 0 ? 'all' : 'any';
  const rulesList = activeKey === 'all' ? group.all ?? [] : group.any ?? [];

  const updateRuleList = (nextRules: SmartPlaylistRule[]) => {
    update({ ...group, [activeKey]: nextRules }, sort, limit);
  };

  const updateRule = (index: number, patch: Partial<SmartPlaylistRule>) => {
    const list = [...rulesList];
    list[index] = { ...list[index], ...patch };
    updateRuleList(list);
  };

  const updateRuleField = (index: number, field: string) => {
    const type = getFieldType(field);
    const operator = defaultOperatorForType(type);
    const value = defaultValueForType(type);
    updateRule(index, { field, operator, value });
  };

  const removeRule = (index: number) => {
    const list = [...rulesList];
    list.splice(index, 1);
    updateRuleList(list);
  };

  const addRule = () => {
    updateRuleList([...rulesList, defaultRule()]);
  };

  const moveRule = (index: number, direction: -1 | 1) => {
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= rulesList.length) return;
    const next = [...rulesList];
    [next[index], next[newIndex]] = [next[newIndex], next[index]];
    updateRuleList(next);
  };

  const toggleMatchType = () => {
    if (activeKey === 'all') {
      update({ any: rulesList }, sort, limit);
    } else {
      update({ all: rulesList }, sort, limit);
    }
  };

  const addSort = () => update(group, [...sort, defaultSort()], limit);

  const updateSortList = (nextSort: SmartPlaylistSort[]) => {
    update(group, ensureDefaultSort(nextSort), limit);
  };

  const removeSort = (index: number) => {
    const next = [...sort];
    next.splice(index, 1);
    updateSortList(next);
  };

  const moveSort = (index: number, direction: -1 | 1) => {
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= sort.length) return;
    const next = [...sort];
    [next[index], next[newIndex]] = [next[newIndex], next[index]];
    updateSortList(next);
  };

  const updateSortField = (index: number, field: string) => {
    const next = [...sort];
    next[index] = { field, direction: 'asc' };
    updateSortList(next);
  };

  const updateSortDirection = (index: number, direction: 'asc' | 'desc' | 'random') => {
    const next = [...sort];
    if (direction === 'random') {
      next[index] = { random: true };
    } else {
      const current = next[index];
      if (current && !('random' in current)) {
        next[index] = { ...current, direction };
      } else {
        next[index] = { field: 'title', direction };
      }
    }
    updateSortList(next);
  };

  return {
    group,
    sort,
    limit,
    activeKey,
    rulesList,
    update,
    updateRule,
    updateRuleField,
    removeRule,
    addRule,
    moveRule,
    toggleMatchType,
    addSort,
    removeSort,
    moveSort,
    updateSortField,
    updateSortDirection,
  };
}
