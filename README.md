# 🧠 Segundo Cérebro (bot do Telegram)

Anote notas, músicas, bandas, filmes/séries, vídeos e lembretes pelo Telegram, consulte por categoria
e veja tudo num dashboard web. Lembretes são avisados **1 dia antes**, **2 horas antes** e **na hora**
(os avisos que já não cabem, num lembrete próximo, são pulados).

Custo: R$ 0 (Telegram Bot API + SQLite + Oracle Cloud Always Free).

## Como usar o bot

| Você manda | O bot faz |
|---|---|
| Qualquer texto (ex.: `Duna Parte 2`) | Pergunta a categoria e salva |
| `oi` ou `/menu` | Pergunta a categoria primeiro, depois o conteúdo |
| Texto com data, ex.: `dentista amanhã 15h`, `me lembra de ligar pra mãe sexta às 3 da tarde` | Separa o assunto da data e pergunta se cria o lembrete |
| Datas aceitas | `daqui a 2 minutos`, `em 2 horas`, `daqui a meia hora`, `daqui a 3 dias`, `hoje 21h`, `amanhã às 9h30`, `sexta 15h`, `próxima segunda às 9`, `sábado que vem 10h`, `dia 25 às 18h`, `25/12 14:30`, `meio-dia`. Sem hora, usa 9h |
| `listar filmes`, `liste as bandas salvas`, `mostrar vídeos`, `listar tudo` | Mostra a lista |
| `/listar` | Botões para escolher a categoria. Cada lista vem com os botões 🗑️ Remover item e 🧹 Limpar lista |
| `apagar 12`, `remover #12` ou `/apagar 12` | Remove o item #12 |
| `remover Duna`, `apagar o filme duna` | Procura pelo nome e mostra botões para escolher qual remover |
| `limpar filmes`, `limpar tudo` ou `/limpar` | Esvazia uma lista (ou todas), depois de confirmar |
| `/cancelar` | Cancela a anotação em andamento |

## 1. Criar o bot no Telegram

1. No Telegram, abra o **@BotFather** e mande `/newbot`.
2. Escolha um nome e um usuário (precisa terminar em `bot`).
3. Copie o **token** que ele devolver.

## 2. Rodar no seu PC (teste)

Requer Node.js 22.13 ou mais novo.

```bash
npm install
cp .env.example .env      # no Windows: copy .env.example .env
# edite .env e cole o BOT_TOKEN
npm start
```

Mande qualquer mensagem ao bot: ele responde com o seu ID. Coloque esse número em `ALLOWED_USER_ID` no `.env`
e reinicie. A partir daí só você consegue usar o bot.

Dashboard: http://127.0.0.1:3000

## 3. Colocar na Oracle Cloud (Always Free)

**Criar a VM:** em cloud.oracle.com → Compute → Instances → Create instance.
- Imagem: **Ubuntu 24.04**
- Shape: **VM.Standard.A1.Flex** (Ampere, 1 OCPU / 6 GB já sobra) ou **VM.Standard.E2.1.Micro**. Ambos são Always Free.
- Baixe a chave SSH na criação.

> Se aparecer "Out of capacity" no A1, tente outro Availability Domain ou tente de novo mais tarde.
> É comum na região de São Paulo.

**Instalar e subir** (conectado via `ssh -i chave.key ubuntu@IP_DA_VM`):

```bash
# Node.js 22
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

# Projeto (envie a pasta com scp ou git clone)
mkdir -p ~/segundo-cerebro && cd ~/segundo-cerebro
# do seu PC: scp -i chave.key -r package.json package-lock.json src public deploy .env ubuntu@IP_DA_VM:~/segundo-cerebro/
npm ci --omit=dev

# Rodar como serviço (sobe sozinho após reboot e reinicia se cair)
sudo cp deploy/segundo-cerebro.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now segundo-cerebro
journalctl -u segundo-cerebro -f      # ver os logs
```

O bot usa *long polling*: **não precisa abrir nenhuma porta** na Oracle para ele funcionar.

**Acessar o dashboard:** o jeito mais seguro é um túnel SSH, sem expor nada na internet:

```bash
ssh -i chave.key -L 3000:127.0.0.1:3000 ubuntu@IP_DA_VM
# e abra http://localhost:3000 no seu navegador
```

Para acessar direto pelo celular, defina `DASHBOARD_HOST=0.0.0.0` e um `DASHBOARD_TOKEN` longo no `.env`, libere a
porta 3000 na Security List da VCN e no firewall do Ubuntu (`sudo iptables -I INPUT -p tcp --dport 3000 -j ACCEPT`)
e acesse `http://IP_DA_VM:3000/?token=SEU_TOKEN`. Atenção: sem HTTPS, o token trafega em texto puro.

**Backup diário** do banco (opcional):

```bash
sudo apt install -y sqlite3
mkdir -p ~/backups
crontab -e
# adicione:
0 3 * * * sqlite3 ~/segundo-cerebro/data/cerebro.db ".backup ~/backups/cerebro-$(date +\%F).db" && find ~/backups -mtime +30 -delete
```

## Estrutura

```
src/index.js       inicialização (.env, bot, lembretes, dashboard)
src/bot.js         conversa no Telegram
src/categories.js  categorias e reconhecimento de "listar ..."
src/dates.js       leitura de datas dos lembretes
src/db.js          banco SQLite (node:sqlite, sem dependências nativas)
src/reminders.js   verificação de lembretes a cada minuto
src/dashboard.js   servidor do dashboard + API /api/items
public/            página do dashboard
test/              testes (npm test)
```

Para adicionar uma categoria, inclua uma linha em `src/categories.js`.
