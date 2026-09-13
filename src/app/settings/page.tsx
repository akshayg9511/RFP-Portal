import { NotBuiltYet } from "../NotBuiltYet";

export default function Page() {
  return (
    <NotBuiltYet
      title="Settings"
      component="Admin config"
      when="last"
      description="Thresholds, scenario ratios and mappings. Values are seeded until then."
    />
  );
}
