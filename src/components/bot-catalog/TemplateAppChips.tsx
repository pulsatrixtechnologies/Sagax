/** The apps a template uses, as chips. Its own file so the catalogue list
 * and the detail do not import each other. */
export function TemplateAppChips({ apps }: { apps: readonly string[] }) {
  if (!apps.length) return null;
  return (
    <span className="flex flex-wrap items-center gap-1" data-catalog-apps="">
      {apps.map((app) => (
        <span key={app} data-catalog-app={app} className="rounded-full border border-hairline-weak px-1.5 py-px text-[10.5px] leading-[15px] text-ink-secondary">{app}</span>
      ))}
    </span>
  );
}
