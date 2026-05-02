'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight, Building2, Folder, Users } from 'lucide-react';
import { clsx } from 'clsx';
import type { OrgNodeSelection, OrgTree } from '@/lib/api';

interface Props {
  tree: OrgTree | null;
  selected: OrgNodeSelection | null;
  onSelect: (node: OrgNodeSelection) => void;
}

/**
 * Three-level org tree (公司 → 部门 → 班组). Departments collapse;
 * the first one is open by default so the most-likely target is one
 * click away.
 */
export function OrgTree({ tree, selected, onSelect }: Props) {
  const [openDepts, setOpenDepts] = useState<Record<string, boolean>>(() => {
    if (!tree?.departments.length) return {};
    return { [tree.departments[0]!.id]: true };
  });

  if (!tree) {
    return <div className="px-2 py-3 text-xs text-slate-400">加载组织架构…</div>;
  }

  const isSel = (type: 'company' | 'department' | 'team', id: string) =>
    selected?.type === type && selected.id === id;

  return (
    <ul className="space-y-1 text-sm">
      {/* Company root */}
      <li>
        <button
          onClick={() =>
            onSelect({ type: 'company', id: tree.id, name: tree.name })
          }
          className={clsx(
            'flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left',
            isSel('company', tree.id)
              ? 'bg-slate-900 text-white'
              : 'text-slate-700 hover:bg-slate-100',
          )}
        >
          <span className="flex items-center gap-2 truncate">
            <Building2 size={14} />
            <span className="truncate font-medium">{tree.name}</span>
          </span>
          <span
            className={clsx(
              'rounded px-1.5 text-xs',
              isSel('company', tree.id) ? 'bg-white/20' : 'bg-slate-100 text-slate-500',
            )}
          >
            {tree.deviceCount}
          </span>
        </button>
      </li>

      {/* Departments */}
      {tree.departments.map((d) => {
        const open = openDepts[d.id] ?? false;
        return (
          <li key={d.id} className="pl-3">
            <div className="flex items-center">
              <button
                onClick={() => setOpenDepts((o) => ({ ...o, [d.id]: !open }))}
                className="flex h-6 w-6 items-center justify-center text-slate-400 hover:text-slate-700"
                aria-label={open ? '收起' : '展开'}
              >
                {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </button>
              <button
                onClick={() =>
                  onSelect({
                    type: 'department',
                    id: d.id,
                    name: d.name,
                    companyId: tree.id,
                  })
                }
                className={clsx(
                  'flex flex-1 items-center justify-between rounded-md px-2 py-1 text-left',
                  isSel('department', d.id)
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-700 hover:bg-slate-100',
                )}
              >
                <span className="flex items-center gap-2 truncate">
                  <Folder size={13} />
                  <span className="truncate">{d.name}</span>
                </span>
                <span
                  className={clsx(
                    'rounded px-1.5 text-xs',
                    isSel('department', d.id)
                      ? 'bg-white/20'
                      : 'bg-slate-100 text-slate-500',
                  )}
                >
                  {d.deviceCount}
                </span>
              </button>
            </div>

            {/* Teams */}
            {open ? (
              <ul className="mt-1 space-y-0.5 pl-7">
                {d.teams.length === 0 ? (
                  <li className="px-2 py-1 text-xs text-slate-400">暂无班组</li>
                ) : (
                  d.teams.map((t) => (
                    <li key={t.id}>
                      <button
                        onClick={() =>
                          onSelect({
                            type: 'team',
                            id: t.id,
                            name: t.name,
                            departmentId: d.id,
                            companyId: tree.id,
                          })
                        }
                        className={clsx(
                          'flex w-full items-center justify-between rounded-md px-2 py-1 text-left',
                          isSel('team', t.id)
                            ? 'bg-slate-900 text-white'
                            : 'text-slate-600 hover:bg-slate-100',
                        )}
                      >
                        <span className="truncate">{t.name}</span>
                        <span
                          className={clsx(
                            'flex items-center gap-2 text-xs',
                            isSel('team', t.id) ? 'text-white/80' : 'text-slate-400',
                          )}
                        >
                          <span className="flex items-center gap-0.5">
                            <Users size={10} /> {t.memberCount}
                          </span>
                          <span className="font-mono">{t.deviceCount}</span>
                        </span>
                      </button>
                    </li>
                  ))
                )}
              </ul>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
