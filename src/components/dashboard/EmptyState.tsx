export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl border border-dashed border-(--line) bg-(--panel) p-8 text-center">
      <p className="font-medium">{title}</p>
      <p className="mt-2 text-sm text-(--muted)">{body}</p>
    </div>
  );
}
