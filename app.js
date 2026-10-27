"use strict";

// ---------- Utilidades ----------
const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const MES_CURTO = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const FORMAS_CONTA = [
  { id: "pix", nome: "Pix", cor: "var(--accent)" },
  { id: "debito", nome: "Débito", cor: "var(--muted)" },
];
const CATEGORIAS_PADRAO = ["Mercado", "Alimentação fora", "Transporte", "Casa", "Saúde", "Lazer", "Compras", "Assinaturas", "Outros"];
const CHAVE = "caixa.v1";

// Mês como número único: ano * 12 + (mês - 1)
const mi = (y, m) => y * 12 + (m - 1);
const yOf = i => Math.floor(i / 12);
const mOf = i => (i % 12) + 1;
const mesStr = i => `${yOf(i)}-${String(mOf(i)).padStart(2, "0")}`;
const mesIdx = s => { const [y, m] = s.split("-").map(Number); return mi(y, m); };
const mesCurto = i => `${MES_CURTO[mOf(i) - 1]}/${yOf(i)}`;
const diasNoMes = i => new Date(yOf(i), mOf(i), 0).getDate();
const brl = v => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const hojeStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const mesAtual = () => { const d = new Date(); return mi(d.getFullYear(), d.getMonth() + 1); };
const diaNum = dia => parseInt(String(dia), 10) || 1;
const centavos = v => Math.round(v * 100) / 100;

function parseValor(txt) {
  const s = String(txt || "").trim().replace(/[R$\s]/g, "");
  if (!s) return 0;
  const n = s.includes(",") ? parseFloat(s.replace(/\./g, "").replace(",", ".")) : parseFloat(s);
  return isFinite(n) && n > 0 ? centavos(n) : 0;
}
const valorTxt = v => v ? String(v.toFixed(2)).replace(".", ",") : "";

// ---------- Dados ----------
function vazio() {
  return {
    versao: 1,
    cartoes: [],
    categorias: CATEGORIAS_PADRAO.slice(),
    recorrentes: [],
    faturas: [],
    gastos: [],
    pagas: {},
    ultimoBackup: null,
  };
}

function normalizar(d) {
  const base = vazio();
  if (!d || typeof d !== "object") return base;
  for (const k of Object.keys(base)) if (d[k] !== undefined) base[k] = d[k];
  if (!Array.isArray(base.categorias) || !base.categorias.length) base.categorias = CATEGORIAS_PADRAO.slice();
  for (const lista of ["cartoes", "recorrentes", "faturas", "gastos"]) {
    if (!Array.isArray(base[lista])) base[lista] = [];
    base[lista].forEach(x => { if (!x.id) x.id = uid(); });
  }
  if (typeof base.pagas !== "object" || !base.pagas) base.pagas = {};
  return base;
}

let db = vazio();
try { db = normalizar(JSON.parse(localStorage.getItem(CHAVE))); } catch (e) { db = vazio(); }

function salvar() {
  try { localStorage.setItem(CHAVE, JSON.stringify(db)); }
  catch (e) { toast("Não consegui salvar. Faça um backup agora."); }
}
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

const temDados = () => db.cartoes.length + db.recorrentes.length + db.gastos.length + db.faturas.length > 0;
const cartao = id => db.cartoes.find(c => c.id === id);
const formas = () => [...FORMAS_CONTA, ...db.cartoes.map(c => ({ id: c.id, nome: c.nome, cor: c.cor || "var(--ink)" }))];
const forma = id => formas().find(f => f.id === id) || { id, nome: id === "conta" ? "Conta" : id, cor: "var(--muted)" };

// ---------- Regras ----------
function ativo(r, i) {
  if (r.inicio && i < mesIdx(r.inicio)) return false;
  if (r.fim && i > mesIdx(r.fim)) return false;
  if (Array.isArray(r.meses) && r.meses.length && !r.meses.includes(mOf(i))) return false;
  return true;
}
function textoParcela(r, i) {
  if (!r.parcela || !r.inicio) return "";
  return `parcela ${r.parcela.numero + i - mesIdx(r.inicio)}/${r.parcela.total}`;
}

// Data em que fecha a fatura que vence no mês i.
function fechamento(c, i) {
  const mesFecha = c.fechamento < c.vencimento ? i : i - 1;
  return mesStr(mesFecha) + "-" + String(Math.min(c.fechamento, diasNoMes(mesFecha))).padStart(2, "0");
}
// Primeira fatura (mês de vencimento) em que entra uma compra feita na data d.
// Compra no dia do fechamento ou depois vai para a fatura seguinte.
function faturaDaCompra(c, d) {
  let i = mesIdx(d.slice(0, 7));
  while (d >= fechamento(c, i)) i++;
  return i;
}

function fatura(c, i) {
  const linhas = [];
  db.recorrentes.filter(r => r.forma === c.id && r.tipo === "saida" && ativo(r, i))
    .forEach(r => linhas.push({ nome: r.nome + (r.parcela ? ` (${textoParcela(r, i)})` : ""), valor: r.valor }));
  db.faturas.filter(f => f.cartao === c.id && f.mes === mesStr(i))
    .forEach(f => linhas.push({ nome: f.nome || "Parcelamentos anteriores", valor: f.valor }));
  db.gastos.filter(g => g.forma === c.id).forEach(g => {
    const primeira = faturaDaCompra(c, g.data);
    const n = g.parcelas || 1;
    const k = i - primeira;
    if (k >= 0 && k < n) {
      // Centavos que sobram da divisão ficam na primeira parcela
      const parcela = Math.floor(g.valor * 100 / n) / 100;
      const valor = k === 0 ? centavos(g.valor - parcela * (n - 1)) : parcela;
      linhas.push({ nome: g.desc + (n > 1 ? ` (${k + 1}/${n})` : ""), valor });
    }
  });
  return { linhas, total: centavos(linhas.reduce((s, l) => s + l.valor, 0)) };
}

function resumo(i) {
  const rec = db.recorrentes.filter(r => ativo(r, i));
  const entradas = rec.filter(r => r.tipo === "entrada").reduce((s, r) => s + r.valor, 0);
  const fixos = rec.filter(r => r.tipo === "saida" && !cartao(r.forma)).reduce((s, r) => s + r.valor, 0);
  const faturas = db.cartoes.reduce((s, c) => s + fatura(c, i).total, 0);
  const doMes = db.gastos.filter(g => mesIdx(g.data.slice(0, 7)) === i);
  const avista = doMes.filter(g => !cartao(g.forma)).reduce((s, g) => s + g.valor, 0);
  const noCartao = doMes.filter(g => cartao(g.forma)).reduce((s, g) => s + g.valor, 0);
  return { entradas, fixos, faturas, avista, noCartao, sobra: entradas - fixos - faturas - avista, doMes };
}

function agenda(i) {
  const itens = [];
  db.recorrentes.filter(r => ativo(r, i) && !cartao(r.forma)).forEach(r => itens.push({
    dia: String(r.dia || "01"), nome: r.nome, sub: textoParcela(r, i), valor: r.valor, tipo: r.tipo === "entrada" ? "in" : "out",
  }));
  db.cartoes.forEach(c => {
    const t = fatura(c, i).total;
    if (t > 0) itens.push({ dia: String(c.vencimento).padStart(2, "0"), nome: "Fatura " + c.nome, valor: t, tipo: "out", cartao: c.id });
  });
  return itens.sort((a, b) => diaNum(a.dia) - diaNum(b.dia) || (a.tipo === "in" ? -1 : 1));
}

// ---------- Estado da tela ----------
const state = { mes: mesAtual(), tab: "mes", filtro: "todos" };

function render() {
  const i = state.mes;
  const titulo = document.getElementById("monthTitle");
  titulo.textContent = `${MESES[mOf(i) - 1]} ${yOf(i)}`;
  document.querySelectorAll(".tab").forEach(t => t.dataset.tab === state.tab ? t.setAttribute("aria-current", "page") : t.removeAttribute("aria-current"));
  const telas = { mes: telaMes, gastos: telaGastos, cartoes: telaCartoes, fixos: telaFixos };
  document.getElementById("view").innerHTML = temDados() || state.tab === "fixos" ? telas[state.tab](i) : telaBoasVindas();
}

// ---------- Telas ----------
function telaBoasVindas() {
  return `<section class="welcome">
    <h2>Bem-vindo ao Caixa</h2>
    <p>Seus dados ficam só neste aparelho. Para começar, importe o arquivo com seus fixos e cartões, ou cadastre tudo na aba Fixos.</p>
    <div class="btnrow">
      <button class="btn solid" data-acao="importar">Importar dados</button>
      <button class="btn" data-acao="ir-fixos">Cadastrar na mão</button>
    </div>
  </section>`;
}

function telaMes(i) {
  const r = resumo(i);
  const comp = r.fixos + r.faturas;
  const base = Math.max(r.entradas, comp + r.avista, 1);
  const pct = x => Math.min(100, 100 * x / base).toFixed(1) + "%";
  const ag = agenda(i);

  const alertas = [];
  if (i === mesAtual()) {
    const hoje = new Date().getDate();
    const proximos = ag.filter(a => a.tipo === "out" && diaNum(a.dia) >= hoje && diaNum(a.dia) - hoje <= 3 && !(a.cartao && db.pagas[a.cartao + ":" + mesStr(i)]));
    const porDia = {};
    proximos.forEach(p => (porDia[diaNum(p.dia)] = porDia[diaNum(p.dia)] || []).push(p));
    Object.entries(porDia).forEach(([dia, itens]) => {
      const quando = dia - hoje === 0 ? "Hoje" : dia - hoje === 1 ? "Amanhã" : `Em ${dia - hoje} dias`;
      alertas.push(`<div class="alert"><span class="dot"></span><div><b>${quando}, dia ${String(dia).padStart(2, "0")}:</b> ${itens.map(p => esc(p.nome)).join(", ")} <span class="num">(${brl(itens.reduce((s, p) => s + p.valor, 0))})</span></div></div>`);
    });
  }
  const diasSemBackup = db.ultimoBackup ? Math.floor((Date.now() - new Date(db.ultimoBackup).getTime()) / 86400000) : null;
  if (temDados() && (diasSemBackup === null || diasSemBackup >= 7)) {
    alertas.push(`<div class="alert"><span class="dot"></span><div><b>Backup:</b> ${diasSemBackup === null ? "você ainda não fez nenhum." : `o último foi há ${diasSemBackup} dias.`}</div><button class="btn" data-acao="backup">Fazer</button></div>`);
  }

  const porCat = {};
  r.doMes.forEach(g => porCat[g.cat] = (porCat[g.cat] || 0) + g.valor);
  const cats = Object.entries(porCat).sort((a, b) => b[1] - a[1]);
  const maxCat = cats.length ? cats[0][1] : 1;

  return `
  <section class="hero">
    <div>
      <div class="label">Sobra prevista no fim do mês</div>
      <div class="big num">${brl(r.sobra)}</div>
    </div>
    <div class="meter" role="img" aria-label="Divisão das entradas do mês">
      <span class="m1" style="width:${pct(comp)}"></span><span class="m2" style="width:${pct(r.avista)}"></span>
    </div>
    <div class="legend num">
      <span><i class="l1"></i>Fixos e faturas ${brl(comp)}</span>
      <span><i class="l2"></i>Pix e débito ${brl(r.avista)}</span>
      <span><i class="l3"></i>Entra ${brl(r.entradas)}</span>
    </div>
  </section>
  ${alertas.join("")}
  ${r.noCartao ? `<p class="note num">Compras no cartão neste mês: <b>${brl(r.noCartao)}</b>. Elas entram nas próximas faturas.</p>` : ""}

  <div class="section">
    <h2>Agenda do mês</h2>
    <div class="panel">
      ${ag.length ? ag.map(a => {
        const [d1, d2] = a.dia.split(/[–-]/);
        return `<div class="row">
          <div class="day num">${esc(d1.padStart(2, "0"))}<small>${d2 ? "a " + esc(d2) : MES_CURTO[mOf(i) - 1]}</small></div>
          <div class="main"><div class="title">${esc(a.nome)}${a.cartao && db.pagas[a.cartao + ":" + mesStr(i)] ? '<span class="tag">paga</span>' : ""}</div>${a.sub ? `<div class="sub">${esc(a.sub)}</div>` : ""}</div>
          <div class="val num ${a.tipo}">${a.tipo === "in" ? "+" : "−"} ${brl(a.valor)}</div>
        </div>`;
      }).join("") : `<div class="empty">Nada previsto neste mês.</div>`}
    </div>
  </div>

  <div class="section">
    <h2>Para onde foi o dinheiro</h2>
    <div class="panel">
      ${cats.length ? cats.map(([c, v]) => `<div class="cat"><span>${esc(c)}</span><span class="num">${brl(v)}</span><div class="bar"><span style="width:${(100 * v / maxCat).toFixed(1)}%"></span></div></div>`).join("")
        : `<div class="empty">Nenhum gasto lançado neste mês. Toque no + para lançar.</div>`}
    </div>
  </div>`;
}

function telaGastos(i) {
  const filtros = [{ id: "todos", nome: "Todos" }, ...formas()];
  const lista = db.gastos.filter(g => mesIdx(g.data.slice(0, 7)) === i && (state.filtro === "todos" || g.forma === state.filtro))
    .sort((a, b) => b.data.localeCompare(a.data) || (b.criado || 0) - (a.criado || 0));
  const total = lista.reduce((s, g) => s + g.valor, 0);
  return `
  <div class="chips" role="group" aria-label="Filtrar por forma de pagamento">
    ${filtros.map(f => `<button class="chip" data-filtro="${esc(f.id)}" aria-pressed="${state.filtro === f.id}">${esc(f.nome)}</button>`).join("")}
  </div>
  <div class="panel">
    ${lista.length ? lista.map(g => {
      const f = forma(g.forma);
      return `<button class="row" data-gasto="${esc(g.id)}">
        <div class="day num">${g.data.slice(8)}<small>${MES_CURTO[Number(g.data.slice(5, 7)) - 1]}</small></div>
        <div class="main"><div class="title">${esc(g.desc)}</div>
        <div class="sub"><span class="pay"><i style="background:${f.cor}"></i>${esc(f.nome)}</span> · ${esc(g.cat)}${g.parcelas > 1 ? ` · ${g.parcelas}x` : ""}</div></div>
        <div class="val num out">${brl(g.valor)}</div>
      </button>`;
    }).join("") : `<div class="empty">Nada lançado aqui ainda.</div>`}
  </div>
  <p class="note num">Total: <b>${brl(total)}</b> em ${lista.length} ${lista.length === 1 ? "gasto" : "gastos"}. Toque num gasto para editar.</p>`;
}

function telaCartoes(i) {
  if (!db.cartoes.length) return `<div class="panel"><div class="empty">Nenhum cartão cadastrado. Cadastre na aba Fixos.</div></div>`;
  return db.cartoes.map(c => {
    const f = fatura(c, i);
    const meses = Array.from({ length: 6 }, (_, n) => i + n);
    const vals = meses.map(m => fatura(c, m).total);
    const max = Math.max(...vals, 1);
    const chave = c.id + ":" + mesStr(i);
    const paga = !!db.pagas[chave];
    const fecha = fechamento(c, i);
    return `<div class="cardbox">
      <div class="cardhead"><span class="name"><i style="background:${esc(c.cor || "var(--ink)")}"></i>${esc(c.nome)}</span><span class="due">vence dia ${String(c.vencimento).padStart(2, "0")}</span></div>
      <div class="billval num">${brl(f.total)}</div>
      <div class="lines num">${f.linhas.length ? f.linhas.map(l => `<div><span>${esc(l.nome)}</span><span>${brl(l.valor)}</span></div>`).join("") : "<div><span>Sem fatura neste mês</span><span></span></div>"}</div>
      <div class="note" style="margin:0">Fecha em ${fecha.slice(8)}/${fecha.slice(5, 7)}. Compras a partir dessa data vão para a fatura seguinte.</div>
      <div class="future" aria-label="Próximas faturas">
        ${meses.map((m, n) => `<div class="${n === 0 ? "cur" : ""}"><b style="height:${Math.max(3, 34 * vals[n] / max)}px"></b>${MES_CURTO[mOf(m) - 1]}</div>`).join("")}
      </div>
      ${f.total > 0 ? `<button class="btn" data-pagar="${esc(chave)}" aria-pressed="${paga}">${paga ? "Fatura paga" : "Marcar fatura como paga"}</button>` : ""}
    </div>`;
  }).join("");
}

function telaFixos(i) {
  const linha = (attr, nome, sub, valor, tipo) => `<button class="row" ${attr}><div class="main"><div class="title">${esc(nome)}</div><div class="sub">${sub}</div></div><div class="val num ${tipo}">${valor === null ? "" : brl(valor)}</div></button>`;
  const vazio = txt => `<div class="empty">${txt}</div>`;
  const descr = r => {
    const partes = [`dia ${esc(r.dia || "01")}`];
    if (cartao(r.forma)) partes.push("no " + esc(cartao(r.forma).nome));
    if (!ativo(r, i)) partes.push("não cai neste mês");
    else if (r.parcela) partes.push(textoParcela(r, i));
    if (Array.isArray(r.meses) && r.meses.length && r.meses.length < 12) partes.push("meses " + r.meses.map(m => MES_CURTO[m - 1]).join(", "));
    partes.push(r.fim ? "até " + mesCurto(mesIdx(r.fim)) : "sem fim");
    return partes.join(" · ");
  };
  const grupo = (titulo, acao, filtro, tipo) => {
    const itens = db.recorrentes.filter(filtro).sort((a, b) => diaNum(a.dia) - diaNum(b.dia));
    return `<div class="section"><h2>${titulo}<button data-acao="${acao}">+ Adicionar</button></h2><div class="panel">
      ${itens.length ? itens.map(r => linha(`data-rec="${esc(r.id)}"`, r.nome, descr(r), r.valor, tipo)).join("") : vazio("Nada cadastrado.")}
    </div></div>`;
  };
  const futuras = db.faturas.filter(f => mesIdx(f.mes) >= i).sort((a, b) => a.mes.localeCompare(b.mes) || a.cartao.localeCompare(b.cartao));

  return (temDados() ? "" : telaBoasVindas())
    + grupo("Entradas", "nova-entrada", r => r.tipo === "entrada", "in")
    + grupo("Contas fixas", "nova-conta", r => r.tipo === "saida" && !cartao(r.forma), "out")
    + grupo("Assinaturas no cartão", "nova-assinatura", r => r.tipo === "saida" && cartao(r.forma), "out")
    + `<div class="section"><h2>Parcelas antigas nos cartões<button data-acao="nova-fatura">+ Adicionar</button></h2><div class="panel">
        ${futuras.length ? futuras.map(f => linha(`data-fat="${esc(f.id)}"`, `${cartao(f.cartao) ? cartao(f.cartao).nome : f.cartao} · ${mesCurto(mesIdx(f.mes))}`, esc(f.nome || "Parcelamentos anteriores"), f.valor, "out")).join("") : vazio("Nenhuma a partir deste mês.")}
      </div><p class="note">Use para o total de parcelas que já estavam na fatura antes de você começar a usar o app. Compras novas parceladas você lança pelo +.</p></div>`
    + `<div class="section"><h2>Cartões<button data-acao="novo-cartao">+ Adicionar</button></h2><div class="panel">
        ${db.cartoes.length ? db.cartoes.map(c => linha(`data-cartao="${esc(c.id)}"`, c.nome, `vence dia ${String(c.vencimento).padStart(2, "0")} · fecha dia ${String(c.fechamento).padStart(2, "0")}`, null, "")).join("") : vazio("Nenhum cartão cadastrado.")}
      </div></div>`
    + `<div class="section"><h2>Backup e ajustes</h2><div class="panel">
        ${linha('data-acao="backup"', "Fazer backup", db.ultimoBackup ? "último em " + new Date(db.ultimoBackup).toLocaleDateString("pt-BR") : "nenhum ainda", null, "")}
        ${linha('data-acao="importar"', "Importar dados", "de um arquivo de backup", null, "")}
        ${linha('data-acao="categorias"', "Categorias", esc(db.categorias.join(", ")), null, "")}
        ${linha('data-acao="apagar"', "Apagar todos os dados", "deste aparelho", null, "")}
      </div></div>`;
}

// ---------- Folhas (formulários) ----------
function abrirFolha(html, montar) {
  const root = document.getElementById("sheetRoot");
  root.innerHTML = `<div class="sheet-bg" data-fechar></div><form class="sheet" novalidate>${html}</form>`;
  const form = root.querySelector("form");
  const fechar = () => { root.innerHTML = ""; };
  root.querySelectorAll("[data-fechar]").forEach(b => b.addEventListener("click", fechar));
  montar(form, fechar);
  const foco = form.querySelector("[data-foco]");
  if (foco) setTimeout(() => foco.focus(), 60);
}
const cab = titulo => `<h3>${titulo}<button type="button" class="iconbtn" data-fechar aria-label="Fechar">×</button></h3>`;
const chips = (nome, opcoes, sel) => `<div class="chips" data-grupo="${nome}">${opcoes.map(o => `<button type="button" class="chip" data-v="${esc(o.id)}" aria-pressed="${o.id === sel}">${esc(o.nome)}</button>`).join("")}</div>`;
function ligarChips(form, nome, onChange) {
  const grupo = form.querySelector(`[data-grupo="${nome}"]`);
  grupo.addEventListener("click", e => {
    const b = e.target.closest(".chip");
    if (!b) return;
    grupo.querySelectorAll(".chip").forEach(x => x.setAttribute("aria-pressed", x === b));
    onChange(b.dataset.v);
  });
}
// Confirmação dentro da própria folha (o iPhone não mostra confirm() em app web)
function confirmarNaFolha(form, texto, rotulo, acao) {
  let box = form.querySelector(".confirm");
  if (box) box.remove();
  box = document.createElement("div");
  box.className = "confirm";
  box.innerHTML = `<div>${texto}</div><div class="btnrow"><button type="button" class="btn danger solid">${rotulo}</button><button type="button" class="btn">Cancelar</button></div>`;
  form.appendChild(box);
  box.querySelector(".danger").onclick = acao;
  box.querySelectorAll(".btn")[1].onclick = () => box.remove();
  box.scrollIntoView({ block: "nearest" });
}

function folhaGasto(g, prefill) {
  const novo = !g;
  const i = state.mes;
  const dataPadrao = i === mesAtual() ? hojeStr() : `${mesStr(i)}-01`;
  const v = g ? { ...g } : { data: dataPadrao, desc: "", valor: 0, forma: "pix", cat: db.categorias[0], parcelas: 1, ...prefill };
  const opcoesForma = formas().map(f => ({ id: f.id, nome: f.nome }));
  const opcoesCat = db.categorias.map(c => ({ id: c, nome: c }));
  if (v.cat && !db.categorias.includes(v.cat)) opcoesCat.push({ id: v.cat, nome: v.cat });
  abrirFolha(`
    ${cab(novo ? "Novo gasto" : "Editar gasto")}
    <div class="amount"><span>R$</span><input id="g-valor" inputmode="decimal" placeholder="0,00" autocomplete="off" aria-label="Valor" value="${valorTxt(v.valor)}" data-foco></div>
    <div class="field"><label for="g-desc">Descrição</label><input id="g-desc" placeholder="Ex.: padaria" autocomplete="off" value="${esc(v.desc)}"></div>
    <div class="field"><span class="flabel">Como pagou</span>${chips("forma", opcoesForma, v.forma)}</div>
    <div class="field"><span class="flabel">Categoria</span>${chips("cat", opcoesCat, v.cat)}</div>
    <div class="two">
      <div class="field"><label for="g-data">Data</label><input id="g-data" type="date" value="${esc(v.data)}"></div>
      <div class="field"><label for="g-parc">Parcelas</label><select id="g-parc" ${cartao(v.forma) ? "" : "disabled"}>${Array.from({ length: 24 }, (_, n) => `<option value="${n + 1}" ${n + 1 === v.parcelas ? "selected" : ""}>${n === 0 ? "À vista" : n + 1 + "x"}</option>`).join("")}</select></div>
    </div>
    <button class="save" type="submit">${novo ? "Lançar gasto" : "Salvar"}</button>
    ${novo ? "" : `<button type="button" class="btn danger" id="g-apagar">Apagar gasto</button>`}
  `, (form, fechar) => {
    const parc = form.querySelector("#g-parc");
    ligarChips(form, "forma", id => { v.forma = id; parc.disabled = !cartao(id); if (parc.disabled) parc.value = "1"; });
    ligarChips(form, "cat", id => { v.cat = id; });
    form.addEventListener("submit", e => {
      e.preventDefault();
      const valor = parseValor(form.querySelector("#g-valor").value);
      if (!valor) { toast("Digite o valor."); form.querySelector("#g-valor").focus(); return; }
      const dados = {
        data: form.querySelector("#g-data").value || dataPadrao,
        desc: form.querySelector("#g-desc").value.trim() || v.cat,
        valor, forma: v.forma, cat: v.cat,
        parcelas: cartao(v.forma) ? Number(parc.value) || 1 : 1,
      };
      if (novo) db.gastos.push({ id: uid(), criado: Date.now(), ...dados });
      else Object.assign(db.gastos.find(x => x.id === g.id), dados);
      salvar();
      state.mes = mesIdx(dados.data.slice(0, 7));
      fechar(); render();
      toast(novo ? `Lançado: ${brl(valor)}` : "Gasto salvo");
    });
    const apagar = form.querySelector("#g-apagar");
    if (apagar) apagar.onclick = () => confirmarNaFolha(form, "Apagar este gasto?", "Apagar", () => {
      db.gastos = db.gastos.filter(x => x.id !== g.id);
      salvar(); fechar(); render(); toast("Gasto apagado");
    });
  });
}

function folhaRecorrente(r, tipoNovo) {
  const novo = !r;
  const v = r ? JSON.parse(JSON.stringify(r)) : {
    nome: "", valor: 0, dia: "05", inicio: mesStr(state.mes), fim: null, meses: null, parcela: null,
    tipo: tipoNovo === "entrada" ? "entrada" : "saida",
    forma: tipoNovo === "assinatura" && db.cartoes[0] ? db.cartoes[0].id : "conta",
  };
  const titulo = v.tipo === "entrada" ? "Entrada" : cartao(v.forma) ? "Assinatura no cartão" : "Conta fixa";
  const opcoesForma = [{ id: "conta", nome: "Conta / Pix" }, ...db.cartoes.map(c => ({ id: c.id, nome: c.nome }))];
  const todosMeses = !v.meses || !v.meses.length;
  abrirFolha(`
    ${cab((novo ? "Nova " : "Editar ") + titulo.toLowerCase())}
    <div class="field"><label for="r-nome">Nome</label><input id="r-nome" value="${esc(v.nome)}" autocomplete="off" data-foco></div>
    <div class="two">
      <div class="field"><label for="r-valor">Valor (R$)</label><input id="r-valor" inputmode="decimal" value="${valorTxt(v.valor)}" placeholder="0,00"></div>
      <div class="field"><label for="r-dia">Dia</label><input id="r-dia" value="${esc(v.dia)}" placeholder="05 ou 15–20"></div>
    </div>
    ${v.tipo === "saida" ? `<div class="field"><span class="flabel">Onde é cobrado</span>${chips("forma", opcoesForma, v.forma)}</div>` : ""}
    <div class="two">
      <div class="field"><label for="r-ini">Começa em</label><input id="r-ini" type="month" value="${esc(v.inicio || "")}"></div>
      <div class="field"><label for="r-fim">Termina em</label><input id="r-fim" type="month" value="${esc(v.fim || "")}"></div>
    </div>
    <div class="field"><span class="flabel">Meses em que cai</span>
      <div class="chips" data-grupo="meses">${MES_CURTO.map((m, n) => `<button type="button" class="chip" data-v="${n + 1}" aria-pressed="${todosMeses || v.meses.includes(n + 1)}">${m}</button>`).join("")}</div>
      <span class="hint">Deixe todos marcados para cair todo mês.</span></div>
    ${v.tipo === "saida" ? `<div class="two">
      <div class="field"><label for="r-pn">Parcela no mês de início</label><input id="r-pn" inputmode="numeric" value="${v.parcela ? v.parcela.numero : ""}" placeholder="opcional"></div>
      <div class="field"><label for="r-pt">Total de parcelas</label><input id="r-pt" inputmode="numeric" value="${v.parcela ? v.parcela.total : ""}" placeholder="opcional"></div>
    </div><span class="hint" style="font-size:12.5px;color:var(--muted)">Com as parcelas preenchidas, o fim é calculado sozinho.</span>` : ""}
    <button class="save" type="submit">Salvar</button>
    ${novo ? "" : `<button type="button" class="btn danger" id="r-apagar">Apagar</button>`}
  `, (form, fechar) => {
    if (v.tipo === "saida") ligarChips(form, "forma", id => { v.forma = id; });
    form.querySelector('[data-grupo="meses"]').addEventListener("click", e => {
      const b = e.target.closest(".chip");
      if (b) b.setAttribute("aria-pressed", b.getAttribute("aria-pressed") !== "true");
    });
    form.addEventListener("submit", e => {
      e.preventDefault();
      const nome = form.querySelector("#r-nome").value.trim();
      const valor = parseValor(form.querySelector("#r-valor").value);
      if (!nome || !valor) { toast("Preencha nome e valor."); return; }
      const meses = [...form.querySelectorAll('[data-grupo="meses"] .chip')].filter(b => b.getAttribute("aria-pressed") === "true").map(b => Number(b.dataset.v));
      if (!meses.length) { toast("Marque pelo menos um mês."); return; }
      const inicio = form.querySelector("#r-ini").value || mesStr(state.mes);
      let fim = form.querySelector("#r-fim").value || null;
      let parcela = null;
      if (v.tipo === "saida") {
        const pn = parseInt(form.querySelector("#r-pn").value, 10), pt = parseInt(form.querySelector("#r-pt").value, 10);
        if (pn > 0 && pt >= pn) { parcela = { numero: pn, total: pt }; fim = mesStr(mesIdx(inicio) + pt - pn); }
      }
      const dados = { nome, valor, dia: form.querySelector("#r-dia").value.trim() || "01", tipo: v.tipo, forma: v.tipo === "entrada" ? "conta" : v.forma, inicio, fim, meses: meses.length === 12 ? null : meses, parcela };
      if (novo) db.recorrentes.push({ id: uid(), ...dados });
      else Object.assign(db.recorrentes.find(x => x.id === r.id), dados);
      salvar(); fechar(); render(); toast("Salvo");
    });
    const apagar = form.querySelector("#r-apagar");
    if (apagar) apagar.onclick = () => confirmarNaFolha(form, `Apagar “${esc(v.nome)}”? Ele some de todos os meses.`, "Apagar", () => {
      db.recorrentes = db.recorrentes.filter(x => x.id !== r.id);
      salvar(); fechar(); render(); toast("Apagado");
    });
  });
}

function folhaFatura(f) {
  if (!db.cartoes.length) { toast("Cadastre um cartão primeiro."); return; }
  const novo = !f;
  const v = f ? { ...f } : { cartao: db.cartoes[0].id, mes: mesStr(state.mes), valor: 0, nome: "Parcelamentos anteriores" };
  abrirFolha(`
    ${cab(novo ? "Parcelas antigas" : "Editar parcelas antigas")}
    <div class="field"><span class="flabel">Cartão</span>${chips("cartao", db.cartoes.map(c => ({ id: c.id, nome: c.nome })), v.cartao)}</div>
    <div class="two">
      <div class="field"><label for="f-mes">Fatura de</label><input id="f-mes" type="month" value="${esc(v.mes)}"></div>
      <div class="field"><label for="f-valor">Valor (R$)</label><input id="f-valor" inputmode="decimal" value="${valorTxt(v.valor)}" placeholder="0,00" data-foco></div>
    </div>
    <div class="field"><label for="f-nome">Descrição</label><input id="f-nome" value="${esc(v.nome)}"></div>
    <button class="save" type="submit">Salvar</button>
    ${novo ? "" : `<button type="button" class="btn danger" id="f-apagar">Apagar</button>`}
  `, (form, fechar) => {
    ligarChips(form, "cartao", id => { v.cartao = id; });
    form.addEventListener("submit", e => {
      e.preventDefault();
      const valor = parseValor(form.querySelector("#f-valor").value);
      const mes = form.querySelector("#f-mes").value;
      if (!valor || !mes) { toast("Preencha mês e valor."); return; }
      const dados = { cartao: v.cartao, mes, valor, nome: form.querySelector("#f-nome").value.trim() || "Parcelamentos anteriores" };
      if (novo) db.faturas.push({ id: uid(), ...dados });
      else Object.assign(db.faturas.find(x => x.id === f.id), dados);
      salvar(); fechar(); render(); toast("Salvo");
    });
    const apagar = form.querySelector("#f-apagar");
    if (apagar) apagar.onclick = () => confirmarNaFolha(form, "Apagar este valor?", "Apagar", () => {
      db.faturas = db.faturas.filter(x => x.id !== f.id);
      salvar(); fechar(); render(); toast("Apagado");
    });
  });
}

function folhaCartao(c) {
  const novo = !c;
  const v = c ? { ...c } : { nome: "", vencimento: 5, fechamento: 28, cor: "#0d6b5c" };
  abrirFolha(`
    ${cab(novo ? "Novo cartão" : "Editar cartão")}
    <div class="field"><label for="c-nome">Nome</label><input id="c-nome" value="${esc(v.nome)}" autocomplete="off" data-foco></div>
    <div class="two">
      <div class="field"><label for="c-venc">Dia do vencimento</label><input id="c-venc" inputmode="numeric" value="${v.vencimento}"></div>
      <div class="field"><label for="c-fecha">Dia do fechamento</label><input id="c-fecha" inputmode="numeric" value="${v.fechamento}"></div>
    </div>
    <span class="hint" style="font-size:12.5px;color:var(--muted)">O fechamento aparece no app do banco, perto da fatura. Compras a partir desse dia vão para a fatura seguinte.</span>
    <div class="field"><label for="c-cor">Cor</label><input id="c-cor" type="color" value="${esc(v.cor)}" style="height:44px;padding:4px"></div>
    <button class="save" type="submit">Salvar</button>
    ${novo ? "" : `<button type="button" class="btn danger" id="c-apagar">Apagar cartão</button>`}
  `, (form, fechar) => {
    form.addEventListener("submit", e => {
      e.preventDefault();
      const nome = form.querySelector("#c-nome").value.trim();
      const venc = parseInt(form.querySelector("#c-venc").value, 10), fecha = parseInt(form.querySelector("#c-fecha").value, 10);
      if (!nome || !(venc >= 1 && venc <= 31) || !(fecha >= 1 && fecha <= 31)) { toast("Preencha nome e dias entre 1 e 31."); return; }
      const dados = { nome, vencimento: venc, fechamento: fecha, cor: form.querySelector("#c-cor").value };
      if (novo) db.cartoes.push({ id: uid(), ...dados });
      else Object.assign(db.cartoes.find(x => x.id === c.id), dados);
      salvar(); fechar(); render(); toast("Cartão salvo");
    });
    const apagar = form.querySelector("#c-apagar");
    if (apagar) apagar.onclick = () => {
      const usos = db.gastos.filter(g => g.forma === c.id).length + db.recorrentes.filter(r => r.forma === c.id).length + db.faturas.filter(f => f.cartao === c.id).length;
      if (usos) { toast(`Esse cartão tem ${usos} lançamentos. Apague ou mude eles antes.`); return; }
      confirmarNaFolha(form, `Apagar o cartão ${esc(c.nome)}?`, "Apagar", () => {
        db.cartoes = db.cartoes.filter(x => x.id !== c.id);
        salvar(); fechar(); render(); toast("Cartão apagado");
      });
    };
  });
}

function folhaCategorias() {
  abrirFolha(`
    ${cab("Categorias")}
    <div class="field"><label for="cat-txt">Uma por linha</label><textarea id="cat-txt" style="font-family:var(--body);font-size:16px">${esc(db.categorias.join("\n"))}</textarea>
    <span class="hint">Gastos antigos mantêm a categoria que já tinham.</span></div>
    <button class="save" type="submit">Salvar</button>
  `, (form, fechar) => {
    form.addEventListener("submit", e => {
      e.preventDefault();
      const lista = [...new Set(form.querySelector("#cat-txt").value.split("\n").map(s => s.trim()).filter(Boolean))];
      if (!lista.length) { toast("Deixe pelo menos uma categoria."); return; }
      db.categorias = lista; salvar(); fechar(); render(); toast("Categorias salvas");
    });
  });
}

// ---------- Backup ----------
async function fazerBackup() {
  const conteudo = JSON.stringify(db, null, 2);
  const nome = `caixa-backup-${hojeStr()}.json`;
  const arquivo = new File([conteudo], nome, { type: "application/json" });
  const marcar = () => { db.ultimoBackup = new Date().toISOString(); salvar(); render(); };
  try {
    if (navigator.canShare && navigator.canShare({ files: [arquivo] })) {
      await navigator.share({ files: [arquivo], title: nome });
      marcar(); toast("Backup salvo"); return;
    }
  } catch (e) {
    if (e && e.name === "AbortError") return;
  }
  const url = URL.createObjectURL(arquivo);
  const a = document.createElement("a");
  a.href = url; a.download = nome;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  marcar(); toast("Backup baixado");
}

function folhaImportar() {
  abrirFolha(`
    ${cab("Importar dados")}
    <p style="margin:0;color:var(--muted)">Escolha o arquivo de backup (.json), ou cole o conteúdo dele aqui. Isso substitui os dados atuais deste aparelho.</p>
    <div class="field"><label for="imp-arq">Arquivo</label><input id="imp-arq" type="file" accept=".json,application/json,text/plain"></div>
    <div class="field"><label for="imp-txt">Ou cole o conteúdo</label><textarea id="imp-txt" placeholder='{"versao": 1, ...}'></textarea></div>
    <button class="save" type="submit">Importar</button>
  `, (form, fechar) => {
    const aplicar = texto => {
      let dados;
      try { dados = JSON.parse(texto); } catch (e) { toast("Esse conteúdo não é um backup válido."); return; }
      if (!dados || dados.versao !== 1) { toast("Esse arquivo não é um backup do Caixa."); return; }
      const executar = () => {
        db = normalizar(dados); salvar(); fechar(); state.tab = "mes"; state.mes = mesAtual(); render();
        toast(`Importado: ${db.recorrentes.length} fixos, ${db.cartoes.length} cartões, ${db.gastos.length} gastos`);
      };
      if (temDados()) confirmarNaFolha(form, "Substituir os dados atuais deste aparelho pelo arquivo?", "Substituir", executar);
      else executar();
    };
    form.addEventListener("submit", async e => {
      e.preventDefault();
      const arq = form.querySelector("#imp-arq").files[0];
      const texto = arq ? await arq.text() : form.querySelector("#imp-txt").value;
      if (!texto.trim()) { toast("Escolha um arquivo ou cole o conteúdo."); return; }
      aplicar(texto);
    });
  });
}

function folhaApagar() {
  abrirFolha(`
    ${cab("Apagar todos os dados")}
    <p style="margin:0">Isso apaga fixos, cartões e gastos deste aparelho. Faça um backup antes, se quiser guardar.</p>
    <button class="save" type="button" id="ap-backup">Fazer backup antes</button>
    <button class="btn danger" type="button" id="ap-sim">Apagar tudo</button>
  `, (form, fechar) => {
    form.querySelector("#ap-backup").onclick = fazerBackup;
    form.querySelector("#ap-sim").onclick = () => confirmarNaFolha(form, "Tem certeza? Não dá para desfazer.", "Sim, apagar tudo", () => {
      db = vazio(); salvar(); fechar(); render(); toast("Dados apagados");
    });
  });
}

// ---------- Avisos ----------
function toast(msg) {
  document.querySelectorAll(".toast").forEach(t => t.remove());
  const t = document.createElement("div");
  t.className = "toast"; t.setAttribute("role", "status"); t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2400);
}

// ---------- Eventos ----------
document.getElementById("prev").onclick = () => { state.mes--; render(); };
document.getElementById("next").onclick = () => { state.mes++; render(); };
document.getElementById("monthTitle").onclick = () => { state.mes = mesAtual(); render(); };
document.getElementById("plus").onclick = () => {
  if (!temDados()) { toast("Importe seus dados ou cadastre seus fixos primeiro."); }
  folhaGasto(null);
};
document.querySelectorAll(".tab").forEach(t => t.onclick = () => { state.tab = t.dataset.tab; window.scrollTo(0, 0); render(); });

document.getElementById("view").addEventListener("click", e => {
  const el = e.target.closest("[data-filtro],[data-pagar],[data-gasto],[data-rec],[data-fat],[data-cartao],[data-acao]");
  if (!el) return;
  const d = el.dataset;
  if (d.filtro) { state.filtro = d.filtro; render(); }
  else if (d.pagar) { db.pagas[d.pagar] ? delete db.pagas[d.pagar] : db.pagas[d.pagar] = true; salvar(); render(); }
  else if (d.gasto) folhaGasto(db.gastos.find(g => g.id === d.gasto));
  else if (d.rec) folhaRecorrente(db.recorrentes.find(r => r.id === d.rec));
  else if (d.fat) folhaFatura(db.faturas.find(f => f.id === d.fat));
  else if (d.cartao) folhaCartao(db.cartoes.find(c => c.id === d.cartao));
  else ({
    "importar": folhaImportar,
    "backup": fazerBackup,
    "categorias": folhaCategorias,
    "apagar": folhaApagar,
    "ir-fixos": () => { state.tab = "fixos"; render(); },
    "nova-entrada": () => folhaRecorrente(null, "entrada"),
    "nova-conta": () => folhaRecorrente(null, "conta"),
    "nova-assinatura": () => { if (!db.cartoes.length) toast("Cadastre um cartão primeiro."); else folhaRecorrente(null, "assinatura"); },
    "nova-fatura": () => folhaFatura(null),
    "novo-cartao": () => folhaCartao(null),
  }[d.acao] || (() => {}))();
});

// Atalho: ?novo=1&valor=12,50&desc=Padaria abre o lançamento já preenchido
(function abrirPorLink() {
  const p = new URLSearchParams(location.search);
  if (!p.has("novo") && !p.has("valor")) return;
  const prefill = {};
  if (p.get("valor")) prefill.valor = parseValor(p.get("valor"));
  if (p.get("desc")) prefill.desc = p.get("desc");
  const f = p.get("forma") && formas().find(x => x.nome.toLowerCase() === p.get("forma").toLowerCase() || x.id === p.get("forma"));
  if (f) prefill.forma = f.id;
  history.replaceState(null, "", location.pathname);
  setTimeout(() => folhaGasto(null, prefill), 50);
})();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}

render();
