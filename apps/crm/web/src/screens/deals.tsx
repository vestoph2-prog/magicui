import { useEffect, useState } from "react";
import {
  DEAL_STAGES,
  type Deal,
  type DealStage,
  isStaff,
  STAGE_LABELS,
} from "../../../shared/model.ts";
import { query, useApi } from "../api.ts";
import { formatMoney } from "../format.ts";
import { navigate, type Route } from "../router.ts";
import {
  type ChipOption,
  Chips,
  DealCard,
  Empty,
  ErrorBox,
  Fab,
  PageTitle,
  useSession,
} from "../ui.tsx";

type StageFilter = DealStage | "all";

export const DealsScreen = ({ route }: { route: Route }) => {
  const user = useSession();
  const stage = (route.params.get("stage") ?? "all") as StageFilter;
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const all = useApi<Deal[]>(`/deals${query({ q })}`);
  const deals = (all.data ?? []).filter(
    (d) => stage === "all" || d.stage === stage
  );
  const countOf = (s: DealStage) =>
    (all.data ?? []).filter((d) => d.stage === s).length;
  const options: ChipOption<StageFilter>[] = [
    { value: "all", label: "Все", count: all.data?.length },
    ...DEAL_STAGES.map((s) => ({
      value: s,
      label: STAGE_LABELS[s],
      count: countOf(s),
    })),
  ];
  const total = deals.reduce((sum, d) => sum + d.amount, 0);

  return (
    <>
      <PageTitle
        action={total ? <b>{formatMoney(total)}</b> : null}
        title="Сделки"
      />
      <input
        aria-label="Поиск сделок"
        className="search"
        onChange={(e) => setSearch(e.target.value)}
        placeholder="🔍 Сделка, заказчик, объект"
        type="search"
        value={search}
      />
      <Chips
        onChange={(v) =>
          navigate(v === "all" ? "/deals" : `/deals?stage=${v}`, true)
        }
        options={options}
        value={stage}
      />
      <ErrorBox message={all.error} />
      <div className="stack">
        {deals.map((d) => (
          <DealCard deal={d} key={d.id} />
        ))}
      </div>
      {all.data && deals.length === 0 ? <Empty>Сделок нет</Empty> : null}
      {isStaff(user.role) ? <Fab label="Новая сделка" to="/deals/new" /> : null}
    </>
  );
};
