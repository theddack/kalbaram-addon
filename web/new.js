// 새 증강 페이지 (new.html): data.json 에서 이번 패치에 처음 보인 증강(firstSeen)과 PBE 미리 보기(preview)를 등급별로 보여 준다.
// 사라진 증강은 build_data.removed_augments 가 남긴 removedAugs. 증강 이름·설명은 게임 데이터, 계산 방식은 rules.json 기준.
(() => {
  const RAR = ["실버", "골드", "프리즘"];
  const CLS = { 실버: "s", 골드: "g", 프리즘: "p" };
  const mm = (v) => String(v || "").split(".").slice(0, 2).join(".");
  // 게임 버전(Data Dragon 16.21.1) → 라이엇 패치 이름(26.21): 2026년부터 연도 기준 번호 (build_data.patch_notes_url 과 같은 규칙)
  const patchName = (v) => { const [a, b] = String(v || "").split("."); return a && b ? `${Number(a) + 10}.${b}` : "?"; };
  // 증강이 아이템 능력치를 바꾸는 변환 → 같이 사면 좋은 아이템 (stats.js conv)
  const CONV_LINK = { bonusHPtoAP: "체력 아이템", bonusHPtoLETHALITY: "체력 아이템", itemMANAtoAP: "마나 아이템", itemADtoAS: "공격력 아이템",
    AStoCRITDMG: "공격 속도 아이템", ultCritDmg: "치명타 아이템", bonusMANAtoAP: "마나 아이템", bonusADtoAP: "공격력 아이템" };
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

  function linkOf(rule) {
    if (rule.items && rule.items.length) return rule.items.join(" · ");
    const st = rule.statsResolved || {};
    for (const k of Object.keys(CONV_LINK)) if (k in st) return CONV_LINK[k];
    if (Object.values(st).some((v) => v && typeof v === "object" && v.ratios && "bonusHP" in v.ratios)) return "체력 아이템";
    return null;
  }

  function status(a, rule) {
    if (a.preview) return ["pre", "미리 보기 (PBE)"];
    if (rule && (rule.stats || rule.statsResolved) && !rule.auto) return ["rule", "계산 규칙"];
    if ((a.effects || []).length) return ["auto", "피해 자동 계산"];
    return ["none", "수치 없음 · 직접 판단"];
  }

  function newAugments(d) {
    return d.augments.filter((a) => a.preview || (a.firstSeen && mm(a.firstSeen) === mm(d.version)));
  }

  function render(d) {
    const webpOnly = new Set(d.iconWebpOnly || []);
    const iconUrl = (id) => `icons/augment/${id}.${webpOnly.has(`augment/${id}`) ? "webp" : d.iconExt || "png"}`;
    const rules = (d.rules && d.rules.augments) || {};
    const list = newAugments(d);
    const preview = list.some((a) => a.preview);
    const cnt = Object.fromEntries(RAR.map((r) => [r, list.filter((a) => a.rarityName === r).length]));
    const kinds = { rule: 0, auto: 0, none: 0, pre: 0 };
    const card = (a) => {
      const rule = rules[a.id] || {};
      const [k, label] = status(a, rules[a.id]);
      kinds[k]++;
      const link = linkOf(rule);
      const q = `${a.name} ${a.enName || ""}`.toLowerCase();
      const tile = a.icon ? `<img src="${esc(iconUrl(a.id))}" alt="" width="56" height="56" loading="lazy">` : `<span class="ph" aria-hidden="true">${esc(a.name.slice(0, 1))}</span>`;
      return `<article class="aug r-${CLS[a.rarityName] || "s"}" data-r="${esc(a.rarityName)}" data-q="${esc(q)}">
  <div class="tile">${tile}</div>
  <div><h3>${esc(a.name)} <span class="en">${esc(a.enName || "")}</span></h3>
    <div class="desc">${a.desc}</div>
    <div class="meta"><span class="st st-${k}">${label}</span>${link ? `<span class="link">연계: ${esc(link)}</span>` : ""}${a.num ? `<span class="num">#${esc(a.num)}</span>` : ""}</div></div>
</article>`;
    };
    const groups = RAR.filter((r) => cnt[r]).map((r) => `<section class="grp" data-grp="${r}"><h2><span class="dot d-${CLS[r]}"></span>${r} <span class="c">${cnt[r]}</span></h2>
<div class="grid">${list.filter((a) => a.rarityName === r).sort((x, y) => x.name.localeCompare(y.name, "ko")).map(card).join("")}</div></section>`).join("");
    document.getElementById("groups").innerHTML = groups || `<p class="empty">${esc(patchName(d.version))} 패치에 새로 들어온 증강이 없어요.</p>`;
    document.getElementById("kicker").textContent = `칼바람 증강 Addon · 패치 ${patchName(d.version)} (게임 ${mm(d.version)})`;
    document.getElementById("title").textContent = `${patchName(d.version)} 새 증강`;
    document.getElementById("lead").textContent = list.length
      ? `이번 패치에 새로 들어온 증강 ${list.length}개예요. 애드온이 각 증강을 어떻게 계산하는지도 같이 적었어요.`
      : "이번 패치에 새로 들어온 증강이 없어요.";
    document.getElementById("stats").innerHTML = list.length ? RAR.map((r) => `<span>${r} <b>${cnt[r]}</b></span>`).join("")
      + `<span>계산 규칙 <b>${kinds.rule}</b></span><span>피해 자동 계산 <b>${kinds.auto}</b></span><span>직접 판단 <b>${kinds.none}</b></span>`
      + (kinds.pre ? `<span>미리 보기 <b>${kinds.pre}</b></span>` : "") : "";
    const warn = document.getElementById("warn");
    if (preview) {
      warn.textContent = "'미리 보기' 증강은 정식 게임 데이터가 아직 공개되지 않아 PBE(테스트 서버) 데이터로 보여 줘요. 수치가 실제와 다를 수 있고, 정식 데이터가 나오면 하루 안에 자동으로 바뀌어요.";
      warn.hidden = false;
    }
    const removed = d.removedAugs || [];
    if (removed.length) {
      document.getElementById("removed-n").textContent = removed.length;
      document.getElementById("removed-list").innerHTML = removed.map((r) => `<li><span class="dot d-${CLS[r.rarityName] || "s"}"></span>${esc(r.name)}</li>`).join("");
      document.getElementById("removed").hidden = false;
    }
    return list.length;
  }

  function bindFilter() {
    const btns = [...document.querySelectorAll(".bar button")];
    const q = document.getElementById("q");
    let f = "all";
    const apply = () => {
      const s = q.value.trim().toLowerCase();
      let shown = 0;
      document.querySelectorAll(".grp").forEach((g) => {
        let n = 0;
        g.querySelectorAll(".aug").forEach((a) => {
          const ok = (f === "all" || a.dataset.r === f) && (!s || a.dataset.q.includes(s));
          a.hidden = !ok;
          if (ok) n++;
        });
        g.hidden = n === 0;
        shown += n;
      });
      document.getElementById("empty").hidden = shown > 0 || !document.querySelector(".grp");
    };
    btns.forEach((b) => b.addEventListener("click", () => {
      f = b.dataset.f;
      btns.forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      apply();
    }));
    q.addEventListener("input", apply);
  }

  window.NewAugs = { newAugments, render, status, linkOf, patchName };
  if (document.getElementById("groups")) {
    bindFilter();
    fetch("data.json").then((r) => r.json()).then(render).catch(() => {
      document.getElementById("lead").textContent = "게임 데이터를 불러오지 못했어요. 잠시 뒤 새로고침해 주세요.";
    });
  }
})();
