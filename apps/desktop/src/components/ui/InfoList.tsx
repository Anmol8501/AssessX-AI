/** Definition-list rows for read-only key/value details (settings, profile). */
export function InfoList({ items }: { items: Array<{ label: string; value: string }> }) {
  return (
    <dl className="divide-line divide-y text-[13.5px]">
      {items.map(({ label, value }) => (
        <div key={label} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
          <dt className="text-ink-muted">{label}</dt>
          <dd className="text-ink font-medium">{value}</dd>
        </div>
      ))}
    </dl>
  )
}
