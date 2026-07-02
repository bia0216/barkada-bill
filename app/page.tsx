"use client";

import { useState } from "react";

// ---------- types ----------
type LineItem = { person: string; amount: number };
type Payment = { person: string; amount: number };
type Expense = {
  id: string;
  name: string;
  mode: "itemized" | "split";
  lineItems: LineItem[];
  payments: Payment[];
};

// ---------- settlement logic (the tested core) ----------
const round2 = (n: number) => Math.round(n * 100) / 100;

function personTotals(expenses: Expense[]) {
  const owe = new Map<string, number>();
  const paid = new Map<string, number>();
  for (const exp of expenses) {
    for (const li of exp.lineItems) owe.set(li.person, (owe.get(li.person) ?? 0) + li.amount);
    for (const pm of exp.payments) paid.set(pm.person, (paid.get(pm.person) ?? 0) + pm.amount);
  }
  const names = new Set([...owe.keys(), ...paid.keys()]);
  return [...names]
    .map((name) => ({
      name,
      owes: round2(owe.get(name) ?? 0),
      paid: round2(paid.get(name) ?? 0),
      net: round2((paid.get(name) ?? 0) - (owe.get(name) ?? 0)),
    }))
    .sort((a, b) => b.net - a.net);
}

// greedy: match biggest creditor with biggest debtor until everyone is at zero
function simplify(rows: ReturnType<typeof personTotals>) {
  const settlements: { from: string; to: string; amount: number }[] = [];
  const people = rows.filter((r) => Math.abs(r.net) > 0.01).map((r) => ({ name: r.name, net: r.net }));
  while (people.length > 1) {
    people.sort((a, b) => b.net - a.net);
    const creditor = people[0];
    const debtor = people[people.length - 1];
    const amt = Math.min(creditor.net, -debtor.net);
    const r = round2(amt);
    if (r <= 0) break;
    settlements.push({ from: debtor.name, to: creditor.name, amount: r });
    creditor.net = round2(creditor.net - amt);
    debtor.net = round2(debtor.net + amt);
    for (let i = people.length - 1; i >= 0; i--) {
      if (Math.abs(people[i].net) < 0.01) people.splice(i, 1);
    }
  }
  return settlements;
}

const peso = (n: number) => "₱" + n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ---------- component ----------
export default function BarkadaBill() {
  const [people, setPeople] = useState<string[]>([]);
  const [newPerson, setNewPerson] = useState("");
  const [expenses, setExpenses] = useState<Expense[]>([]);

  // add-expense form state
  const [expName, setExpName] = useState("");
  const [mode, setMode] = useState<"itemized" | "split">("itemized");
  const [itemAmounts, setItemAmounts] = useState<Record<string, string>>({}); // itemized: per-person owed
  const [splitTotal, setSplitTotal] = useState("");
  const [splitPeople, setSplitPeople] = useState<string[]>([]); // who shares the split
  const [payments, setPayments] = useState<Record<string, string>>({}); // who paid how much
  const [formError, setFormError] = useState("");

  function clearForm() {
    setExpName("");
    setItemAmounts({});
    setSplitTotal("");
    setSplitPeople([]);
    setPayments({});
    setFormError("");
  }

  function addPerson() {
  const names = newPerson
    .split(",")                       // split on commas
    .map((n) => n.trim())             // trim spaces around each
    .filter((n) => n.length > 0);     // drop empties (e.g. trailing comma)

  if (names.length === 0) return;

  setPeople((prev) => {
    const next = [...prev];
    for (const name of names) {
      if (!next.includes(name)) next.push(name); // skip duplicates
    }
    return next;
  });

  setNewPerson("");
}

  function removePerson(name: string) {
    setPeople(people.filter((p) => p !== name));
  }

  function toggleSplitPerson(name: string) {
    setSplitPeople((prev) => (prev.includes(name) ? prev.filter((p) => p !== name) : [...prev, name]));
  }

  function togglePayer(name: string) {
  setPayments((prev) => {
    const next = { ...prev };
    if (name in next) {
      delete next[name]; // un-pick: remove them
    } else {
      next[name] = ""; // pick: add empty amount field
    }
    return next;
  });
    }

  function addExpense() {
    setFormError("");

    if (!expName.trim()) return setFormError("Give the expense a name (e.g. Mang Inasal).");

    let lineItems: LineItem[] = [];
    if (mode === "itemized") {
      lineItems = people
        .map((p) => ({ person: p, amount: parseFloat(itemAmounts[p] || "0") }))
        .filter((li) => li.amount > 0);
    } else {
      const total = parseFloat(splitTotal || "0");
      if (total <= 0 || splitPeople.length === 0)
        return setFormError("Enter a total and pick who splits it.");
      const share = round2(total / splitPeople.length);
      lineItems = splitPeople.map((p) => ({ person: p, amount: share }));
    }

    const pays: Payment[] = people
      .map((p) => ({ person: p, amount: parseFloat(payments[p] || "0") }))
      .filter((pm) => pm.amount > 0);

    if (lineItems.length === 0) return setFormError("No amounts entered.");
    if (pays.length === 0) return setFormError("Record who paid (at least one payer).");

    const owed = round2(lineItems.reduce((s, li) => s + li.amount, 0));
    const paidTotal = round2(pays.reduce((s, pm) => s + pm.amount, 0));
    if (Math.abs(owed - paidTotal) > 0.01) {
      return setFormError(
        `Owed total (${peso(owed)}) doesn't match paid total (${peso(paidTotal)}). Fix the amounts.`
      );
    }

    setExpenses([
      ...expenses,
      { id: crypto.randomUUID(), name: expName.trim(), mode, lineItems, payments: pays },
    ]);
  }

  function removeExpense(id: string) {
    setExpenses(expenses.filter((e) => e.id !== id));
  }

  const rows = personTotals(expenses);
  const settlements = simplify(rows);

  // live totals for the add-expense form
    const orderTotal = round2(
    mode === "itemized"
        ? people.reduce((s, p) => s + (parseFloat(itemAmounts[p] || "0") || 0), 0)
        : parseFloat(splitTotal || "0") || 0
    );

    const paidSoFar = round2(
    Object.values(payments).reduce((s, v) => s + (parseFloat(v || "0") || 0), 0)
    );

    const remaining = round2(orderTotal - paidSoFar);

  return (
    <main style={{ maxWidth: "720px", width: "100%", margin: "0 auto", padding: 24, fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ fontSize: 24, marginBottom: 4 }}>Barkada Bill</h1>
      <p style={{ color: "#666", marginTop: 0 }}>Track kanya-kanya orders and hatian, settle up who pays whom.</p>

      {/* --- People --- */}
      <section style={card}>
        <h2 style={h2}>People</h2>
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <input
            value={newPerson}
            onChange={(e) => setNewPerson(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addPerson()}
            placeholder="Add names, separated by commas"
            style={input}
          />
          <button onClick={addPerson} style={btn}>Add</button>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {people.map((p) => (
            <span key={p} style={pill}>
              {p}
              <button onClick={() => removePerson(p)} style={pillX}>×</button>
            </span>
          ))}
          {people.length === 0 && <span style={{ color: "#999" }}>No one added yet.</span>}
        </div>
      </section>

      {/* --- Add expense --- */}
      {people.length > 0 && (
        <section style={card}>
          <h2 style={h2}>Add an expense</h2>
          <input
            value={expName}
            onChange={(e) => setExpName(e.target.value)}
            placeholder="What was it? e.g. Mang Inasal"
            style={{ ...input, width: "100%", marginBottom: 12 }}
          />

          {/* mode toggle */}
          <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
            <button onClick={() => setMode("itemized")} style={mode === "itemized" ? btnActive : btn}>
              Itemized (different orders)
            </button>
            <button onClick={() => setMode("split")} style={mode === "split" ? btnActive : btn}>
              Split evenly (hatian)
            </button>
          </div>

          {mode === "itemized" ? (
            <div style={{ marginBottom: 16 }}>
              <p style={label}>What each person ordered</p>
              {people.map((p) => (
                <div key={p} style={row}>
                  <span style={{ width: 120 }}>{p}</span>
                  <input
                    type="number"
                    value={itemAmounts[p] ?? ""}
                    onChange={(e) => setItemAmounts({ ...itemAmounts, [p]: e.target.value })}
                    placeholder="0.00"
                    style={input}
                  />
                </div>
              ))}
              {orderTotal > 0 && (
                <p style={{ fontSize: 14, fontWeight: 600, margin: "4px 0 0" }}>
                    Total: {peso(orderTotal)}
                </p>
                )}
            </div>
          ) : (
            <div style={{ marginBottom: 16 }}>
              <p style={label}>Total to split</p>
              <input
                type="number"
                value={splitTotal}
                onChange={(e) => setSplitTotal(e.target.value)}
                placeholder="0.00"
                style={{ ...input, marginBottom: 12 }}
              />
              <p style={label}>Split between</p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {people.map((p) => (
                  <button
                    key={p}
                    onClick={() => toggleSplitPerson(p)}
                    style={splitPeople.includes(p) ? btnActive : btn}
                  >
                    {p}
                  </button>
                ))}
              </div>
              {splitTotal && splitPeople.length > 0 && (
                <p style={{ color: "#666", fontSize: 13, marginTop: 8 }}>
                  = {peso(round2(parseFloat(splitTotal) / splitPeople.length))} each
                </p>
              )}
            </div>
          )}

                {/* payers — pick who volunteered, then enter only their amounts */}
        <div style={{ marginBottom: 16 }}>
        <p style={label}>Who volunteered to pay?</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
            {people.map((p) => (
            <button
                key={p}
                onClick={() => togglePayer(p)}
                style={p in payments ? btnActive : btn}
            >
                {p}
            </button>
            ))}
        </div>

        {Object.keys(payments).length > 0 && (
            <>
            <p style={label}>How much did each pay?</p>
            {Object.keys(payments).map((p) => (
                <div key={p} style={row}>
                <span style={{ width: 120 }}>{p}</span>
                <input
                    type="number"
                    value={payments[p]}
                    onChange={(e) => setPayments({ ...payments, [p]: e.target.value })}
                    placeholder="0.00"
                    style={input}
                />
                </div>
            ))}
            {Object.keys(payments).length > 0 && (
                <p style={{ fontSize: 13, marginTop: 8 }}>
                    <span style={{ color: "#666" }}>Paid so far: </span>
                    <strong>{peso(paidSoFar)}</strong>
                    {" · "}
                    {remaining > 0.01 ? (
                    <span style={{ color: "#dc2626" }}>{peso(remaining)} left to cover</span>
                    ) : remaining < -0.01 ? (
                    <span style={{ color: "#dc2626" }}>over by {peso(-remaining)}</span>
                    ) : (
                    <span style={{ color: "#16a34a" }}>fully covered ✓</span>
                    )}
                </p>
                )}
            </>
        )}
        </div>

          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={addExpense} style={{ ...btn, ...btnPrimary }}>Add expense</button>
            <button onClick={clearForm} style={btn}>Clear</button>
        </div>
        </section>
      )}

      {/* --- Expense list --- */}
      {expenses.length > 0 && (
        <section style={card}>
          <h2 style={h2}>Expenses</h2>
          {expenses.map((e) => {
            const total = round2(e.lineItems.reduce((s, li) => s + li.amount, 0));
            return (
              <div key={e.id} style={{ borderBottom: "1px solid #eee", padding: "10px 0" }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <strong>{e.name}</strong>
                  <span>
                    {peso(total)}{" "}
                    <button onClick={() => removeExpense(e.id)} style={pillX}>×</button>
                  </span>
                </div>
                <div style={{ color: "#666", fontSize: 13 }}>
                  {e.mode === "split" ? "Split evenly" : "Itemized"} · paid by{" "}
                  {e.payments.map((pm) => `${pm.person} (${peso(pm.amount)})`).join(", ")}
                </div>
              </div>
            );
          })}
        </section>
      )}

      {/* --- Settlement --- */}
      {rows.length > 0 && (
        <section style={card}>
          <h2 style={h2}>Settle up</h2>
          {settlements.length === 0 ? (
            <p style={{ color: "#16a34a" }}>Everyone's settled up! 🎉</p>
          ) : (
            settlements.map((s, i) => (
              <div key={i} style={row}>
                <strong style={{ color: "#dc2626" }}>{s.from}</strong>
                <span style={{ color: "#666" }}>pays</span>
                <strong style={{ color: "#16a34a" }}>{s.to}</strong>
                <span style={{ marginLeft: "auto", fontWeight: 600 }}>{peso(s.amount)}</span>
              </div>
            ))
          )}

          <details style={{ marginTop: 16 }}>
            <summary style={{ cursor: "pointer", color: "#666" }}>See balances</summary>
            <div style={{ marginTop: 8 }}>
              {rows.map((r) => (
                <div key={r.name} style={row}>
                  <span style={{ width: 120 }}>{r.name}</span>
                  <span style={{ color: "#666", fontSize: 13 }}>
                    paid {peso(r.paid)}, owes {peso(r.owes)} →
                  </span>
                  <span style={{ marginLeft: "auto", color: r.net >= 0 ? "#16a34a" : "#dc2626" }}>
                    {r.net >= 0 ? `owed ${peso(r.net)}` : `owes ${peso(-r.net)}`}
                  </span>
                </div>
              ))}
            </div>
          </details>
        </section>
      )}

      {formError && (
        <div
          onClick={() => setFormError("")}
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)",
            display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "#fff", borderRadius: 12, padding: 24,
              maxWidth: 360, width: "90%", boxShadow: "0 10px 40px rgba(0,0,0,0.2)",
            }}
          >
            <p style={{ margin: "0 0 16px", fontSize: 15, color: "#111" }}>{formError}</p>
            <button onClick={() => setFormError("")} style={{ ...btn, ...btnPrimary, width: "100%" }}>
              Got it
            </button>
          </div>
        </div>
      )}
      
    </main>
  );
}

// ---------- inline styles (swap for Tailwind if you want) ----------
const card: React.CSSProperties = { border: "1px solid #e5e5e5", borderRadius: 12, padding: 16, marginTop: 16 };
const h2: React.CSSProperties = { fontSize: 16, marginTop: 0, marginBottom: 12 };
const label: React.CSSProperties = { fontSize: 13, color: "#666", margin: "0 0 8px" };
const input: React.CSSProperties = { flex: 1, minWidth: 0, padding: "8px 10px", border: "1px solid #ccc", borderRadius: 8, fontSize: 14 };const btn: React.CSSProperties = { padding: "8px 14px", border: "1px solid #ccc", borderRadius: 8, background: "#fff", cursor: "pointer", fontSize: 14 };
const btnActive: React.CSSProperties = { ...btn, background: "#111", color: "#fff", border: "1px solid #111" };
const btnPrimary: React.CSSProperties = { background: "#111", color: "#fff", borderColor: "#111" };
const row: React.CSSProperties = { display: "flex", alignItems: "center", gap: 10, marginBottom: 8 };
const pill: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 10px", background: "#f3f4f6", borderRadius: 999, fontSize: 14 };
const pillX: React.CSSProperties = { border: "none", background: "none", cursor: "pointer", color: "#999", fontSize: 16, lineHeight: 1 };