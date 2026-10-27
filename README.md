# Caixa

App pessoal de controle financeiro para iPhone, feito como app web instalado na tela inicial.

- Visão do mês: quanto entra, quanto já está comprometido e quanto sobra.
- Lançamento rápido de gastos (Pix, débito ou cartão, com parcelas).
- Faturas de cada cartão pelo vencimento, respeitando o dia de fechamento.
- Entradas, contas fixas e assinaturas que se repetem sozinhas, com data de fim.
- Backup e importação em arquivo.

## Privacidade

Este repositório guarda só o código. Nenhum dado financeiro fica aqui: tudo o que você lança é salvo apenas no aparelho, dentro do app. Para não perder nada, use o botão **Fazer backup** (aba Fixos) e salve o arquivo no iCloud Drive.

## Instalar no iPhone

1. Abra o endereço do app no **Safari**.
2. Toque em **Compartilhar** e depois em **Adicionar à Tela de Início**.
3. Abra pelo ícone. Na primeira vez, toque em **Importar dados** e escolha o seu arquivo.

Os dados do app instalado ficam separados dos dados do Safari, então importe pelo ícone da tela inicial.

## Atalho para lançar rápido

O endereço aceita parâmetros que abrem o lançamento já preenchido:

```
?valor=12,50&desc=Padaria&forma=XP
```

## Como funciona por dentro

HTML, CSS e JavaScript puros, sem build. Os dados ficam no `localStorage` do aparelho e o `sw.js` deixa o app abrir sem internet.
