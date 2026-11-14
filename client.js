/**
 * dsh-migrate —— 客户端半边：DSH「设置」里的「记忆搬家」section
 *
 * 两块模式：
 *   新手 —— 只选「完整度 + 路径」，其他都替他选好
 *   老手 —— 插件怎么打、额外带什么、压不压 zip，全部自选
 *
 * 风格参考 dsh-world：暖色、衬线标题、金色点缀、圆角卡片。
 * 重活都在 host 半边（/memory-sync/api/*）。
 *
 * 注意：这是渲染层模块，id 必须与 package.json 的 name 一致，且全工程只能注册
 * 一次（上次 DSH 崩溃就是 id 撞了）。改这个文件之前先想清楚。
 */
window.__ModuleLoader__.load({
  id: 'dsh-migrate',
  factory(require) {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const { createElement: h, useCallback, useEffect, useState } = React

    const API = '/memory-sync/api/'
    const CSS_TAG = 'dsh-migrate/section.css'
    const CSS = [
      '.dm{--ink:var(--dsw-alias-label-primary,#e8e3d6);--soft:var(--dsw-alias-label-tertiary,#9a9384);--gold:#c49a52;--line:var(--dsw-alias-border-l1,rgba(255,255,255,.14));--paper:var(--dsw-alias-bg-l1,rgba(255,255,255,.04));--warn:#e5484d;',
      'max-width:780px;display:flex;flex-direction:column;gap:18px;font-size:13px;line-height:1.65;color:var(--ink)}',
      '.dm *{box-sizing:border-box}',
      '.dm-head{display:flex;flex-direction:column;gap:4px;padding:2px 2px 8px;border-bottom:1px solid var(--line)}',
      '.dm-eyebrow{font-size:10px;letter-spacing:.24em;text-transform:uppercase;color:var(--soft)}',
      '.dm-title{margin:0;font:600 24px/1.25 var(--serif,Georgia,"Songti SC",serif);letter-spacing:.04em;color:var(--ink)}',
      '.dm-sub{margin:2px 0 0;font-size:13px;color:var(--soft);line-height:1.7}',
      '.dm-card{border:1px solid var(--line);border-radius:14px;padding:16px 18px;background:var(--paper);display:flex;flex-direction:column;gap:14px}',
      '.dm-card h4{margin:0;font:600 13px/1.4 var(--serif,Georgia,"Songti SC",serif);letter-spacing:.14em;display:flex;align-items:center;gap:8px;color:var(--ink)}',
      '.dm-card h4:before{content:"";width:14px;height:1px;background:var(--gold)}',
      '.dm-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}',
      '.dm-label{font-size:12px;letter-spacing:.08em;color:var(--soft);min-width:72px;flex-shrink:0}',
      '.dm-help{margin:0;font-size:12px;line-height:1.7;color:var(--soft)}',
      '.dm-input{flex:1;min-width:240px;padding:8px 11px;border-radius:9px;border:1px solid var(--line);background:transparent;color:var(--ink);font-size:13px;outline:none}',
      '.dm-input:focus{border-color:var(--gold);box-shadow:0 0 0 3px rgba(196,154,82,.16)}',
      '.dm-input::placeholder{color:var(--soft);opacity:.75}',
      '.dm-btn{appearance:none;padding:8px 16px;border-radius:9px;border:1px solid var(--line);background:rgba(255,255,255,.07);color:var(--ink);cursor:pointer;font-size:13px;line-height:1.2;transition:border-color .2s,background .2s,transform .12s}',
      '.dm-btn:hover:not(:disabled){border-color:var(--gold);transform:translateY(-1px)}',
      '.dm-btn:disabled{opacity:.5;cursor:default;transform:none}',
      '.dm-btn-primary{background:var(--gold);border-color:var(--gold);color:#2a2116;font-weight:600;box-shadow:0 6px 18px -10px rgba(196,154,82,.9)}',
      '.dm-btn-primary:hover:not(:disabled){background:#d0a862;border-color:#d0a862}',
      '.dm-btn-ghost{background:transparent;color:var(--ink)}',
      '.dm-tabs{display:flex;gap:4px;border-bottom:1px solid var(--line);padding:0 4px}',
      '.dm-tab{position:relative;font:500 13px var(--serif,Georgia,"Songti SC",serif);letter-spacing:.12em;padding:8px 16px 10px;background:none;border:0;color:var(--soft);cursor:pointer}',
      '.dm-tab:after{content:"";position:absolute;left:50%;right:50%;bottom:-1px;height:2px;background:var(--gold);transition:left .25s,right .25s}',
      '.dm-tab.on{color:var(--ink)}',
      '.dm-tab.on:after{left:12px;right:12px}',
      '.dm-choices{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px}',
      '.dm-choice{display:flex;align-items:flex-start;gap:10px;padding:12px 14px;border:1px solid var(--line);border-radius:11px;cursor:pointer;transition:border-color .2s,background .2s}',
      '.dm-choice:hover{border-color:var(--gold)}',
      '.dm-choice.on{border-color:var(--gold);background:rgba(196,154,82,.10)}',
      '.dm-choice input{margin:3px 0 0;accent-color:var(--gold)}',
      '.dm-choice b{font-weight:600;font-size:13px}',
      '.dm-choice small{display:block;color:var(--soft);font-size:12px;line-height:1.6;margin-top:2px}',
      '.dm-check{display:inline-flex;align-items:center;gap:8px;padding:6px 12px;border:1px solid var(--line);border-radius:999px;cursor:pointer;font-size:12px;color:var(--ink);background:transparent}',
      '.dm-check input{accent-color:var(--gold);margin:0}',
      '.dm-check.on{border-color:var(--gold);background:rgba(196,154,82,.10)}',
      '.dm-err{margin:0;padding:12px 14px;border:1px solid rgba(229,72,77,.4);border-radius:11px;background:rgba(229,72,77,.08);color:var(--warn);font-size:13px;white-space:pre-wrap}',
      '.dm-ok{border:1px solid rgba(196,154,82,.4);border-radius:11px;padding:13px 15px;background:rgba(196,154,82,.07);font-size:13px;line-height:1.75;white-space:pre-wrap;word-break:break-all}',
      '.dm-ok .dm-k{color:var(--soft);margin-right:6px}',
      '.dm-packs{display:flex;flex-direction:column;gap:8px;max-height:220px;overflow:auto}',
      '.dm-pack{border-left:2px solid var(--gold);padding:2px 0 2px 10px;font-size:12px;color:var(--soft);word-break:break-all}',
      '.dm-pack b{color:var(--ink);font-weight:600}',
      '.dm-empty{color:var(--soft);font-size:12px;padding:4px 0}',
      '.dm-guide{border:1px solid var(--gold);border-radius:14px;padding:16px 18px;background:rgba(196,154,82,.06);display:flex;flex-direction:column;gap:10px}',
      '.dm-guide-head{display:flex;align-items:center;gap:10px}',
      '.dm-guide-dots{display:flex;gap:5px;flex:1}',
      '.dm-guide-dot{width:6px;height:6px;border-radius:50%;background:var(--line);display:inline-block}',
      '.dm-guide-dot.on{background:var(--gold)}',
      '.dm-guide-count{font-size:11px;color:var(--soft);letter-spacing:.1em}',
      '.dm-guide-x{background:none;border:0;color:var(--soft);font-size:18px;line-height:1;cursor:pointer;padding:0 2px}',
      '.dm-guide-x:hover{color:var(--ink)}',
      '.dm-guide-title{margin:0;font:600 16px/1.4 var(--serif,Georgia,"Songti SC",serif);color:var(--ink)}',
      '.dm-guide-body{margin:0;font-size:13px;line-height:1.8;color:var(--ink)}',
      '.dm-guide-note{margin:0;font-size:12px;color:var(--soft);font-style:italic}',
      '.dm-guide-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:2px}',
    ].join('\n')

    function ensureCss() {
      if (typeof document === 'undefined') return
      if (document.querySelector('style[data-dm-css="' + CSS_TAG + '"]')) return
      const style = document.createElement('style')
      style.setAttribute('data-dm-css', CSS_TAG)
      style.textContent = CSS
      document.head.appendChild(style)
    }

    async function call(path, options) {
      const response = await fetch(API + path, options)
      const text = await response.text()
      let doc = null
      try {
        doc = text ? JSON.parse(text) : null
      } catch {
        doc = { ok: false, error: text }
      }
      if (!response.ok || doc?.ok === false) {
        throw new Error(doc?.error || ('HTTP ' + response.status))
      }
      return doc
    }

    function fmtBytes(value) {
      const n = Number(value) || 0
      if (n < 1024) return n + ' B'
      if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB'
      return (n / 1024 / 1024).toFixed(1) + ' MB'
    }

    const PRESET_INFO = {
      essential: { label: '精简', desc: '配置 + 记忆。最小，够把设置带过去。' },
      standard: { label: '标准', desc: '+ 会话 + 世界。日常换电脑用这档。' },
      everything: { label: '全量', desc: '+ 附件。一个包搬完，体积最大。' },
    }

    const EXTRA_INFO = {
      config: '配置',
      sessions: '会话',
      attachments: '附件',
      worlds: '世界',
    }

    // ---------- 新手引导 ----------
    const GUIDE_KEY = 'dsh-migrate/guide-seen'

    function guideSeen() {
      try {
        if (typeof localStorage === 'undefined') return true
        return localStorage.getItem(GUIDE_KEY) === '1'
      } catch {
        return true
      }
    }

    function markGuideSeen() {
      try {
        if (typeof localStorage !== 'undefined') localStorage.setItem(GUIDE_KEY, '1')
      } catch {
        // ignore
      }
    }

    const GUIDE_STEPS = [
      {
        title: '这是干什么的',
        body: '把这一台 DSH 的「插件 + 配置 + 会话 + 记忆」打成一个包。换电脑时不用重新配一遍，跑个脚本就都回来了。',
        note: '不是备份到网盘，是打包带走。',
      },
      {
        title: '包里会有什么',
        body: '一个文件夹（或一个 .zip）：插件本体、配置、你的聊天记录、记忆快照，再加一个 install.ps1 安装脚本。',
        note: '脚本跟着包走，新电脑不用先装这个插件。',
      },
      {
        title: '新电脑怎么用',
        body: '① 把包拷过去 → ② 先跑 install.ps1 -DryRun 预演一遍 → ③ 没问题再去掉 -DryRun 真跑。',
        note: '预演不会改任何东西，只是告诉你它准备干什么。',
      },
      {
        title: '那就开始吧',
        body: '新手模式只要选两样：完整度、放哪。其他我都替你想好了。想细调就切到「老手」。',
        note: '这个引导随时可以在右上角重新打开。',
      },
    ]

    function GuideCard({ step, onNext, onPrev, onClose }) {
      const info = GUIDE_STEPS[step] || GUIDE_STEPS[0]
      const last = step >= GUIDE_STEPS.length - 1
      return h(
        'div',
        { className: 'dm-guide' },
        h('div', { className: 'dm-guide-head' },
          h('span', { className: 'dm-guide-dots' },
            ...GUIDE_STEPS.map((_, i) =>
              h('i', { key: i, className: 'dm-guide-dot' + (i === step ? ' on' : '') }))),
          h('span', { className: 'dm-guide-count' }, (step + 1) + ' / ' + GUIDE_STEPS.length),
          h('button', { className: 'dm-guide-x', onClick: onClose, title: '关闭引导' }, '×'),
        ),
        h('h3', { className: 'dm-guide-title' }, info.title),
        h('p', { className: 'dm-guide-body' }, info.body),
        h('p', { className: 'dm-guide-note' }, info.note),
        h('div', { className: 'dm-guide-actions' },
          h('button', { className: 'dm-btn dm-btn-ghost', onClick: onClose }, '跳过'),
          h('button', { className: 'dm-btn', onClick: onPrev, disabled: step === 0 }, '上一步'),
          h('button', { className: 'dm-btn dm-btn-primary', onClick: onNext }, last ? '开始打包' : '下一步'),
        ),
      )
    }

    function MigrateSection() {
      const [view, setView] = useState('beginner')
      const [preset, setPreset] = useState('standard')
      const [mode, setMode] = useState('lite')
      const [extras, setExtras] = useState({ config: true, sessions: true, attachments: false, worlds: true })
      const [out, setOut] = useState('')
      const [zip, setZip] = useState(false)
      const [includeMemory, setIncludeMemory] = useState(true)
      const [busy, setBusy] = useState('')
      const [error, setError] = useState('')
      const [result, setResult] = useState(null)
      const [packs, setPacks] = useState([])
      const [guide, setGuide] = useState(() => (guideSeen() ? -1 : 0))


      useEffect(() => {
        ensureCss()
      }, [])

      const loadPacks = useCallback(async () => {
        try {
          const doc = await call('packs')
          setPacks(Array.isArray(doc.packs) ? doc.packs : [])
        } catch {
          setPacks([])
        }
      }, [])

      useEffect(() => {
        void loadPacks()
      }, [loadPacks])

      const browse = useCallback(async () => {
        setBusy('browse')
        setError('')
        try {
          const doc = await call('browse', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ initial: out.trim() }),
          })
          if (doc.path) setOut(doc.path)
        } catch (err) {
          setError(String(err?.message || err))
        } finally {
          setBusy('')
        }
      }, [out])

      const runPack = useCallback(async () => {
        setBusy('pack')
        setError('')
        setResult(null)
        try {
          const body = view === 'beginner'
            ? { mode: 'lite', preset, out: out.trim(), zip, includeMemory }
            : { mode, include: extras, out: out.trim(), zip, includeMemory }
          const doc = await call('pack', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          })
          setResult(doc.result || null)
          await loadPacks()
        } catch (err) {
          setError(String(err?.message || err))
        } finally {
          setBusy('')
        }
      }, [view, preset, mode, extras, out, zip, includeMemory, loadPacks])

      const summary = result
        ? [
            ['输出', result.zip?.path || result.root || ''],
            result.zip ? ['压缩包', fmtBytes(result.zip.bytes)] : null,
            ['本地插件', ((result.manifest?.plugins?.packed || []).length) + ' 个'],
            ['npm 插件', ((result.manifest?.plugins?.npm || []).length) + ' 个'],
            ['记忆快照', result.manifest?.memory
              ? (result.manifest.memory.files + ' 个文件 / ' + fmtBytes(result.manifest.memory.bytes))
              : '未包含'],
            ['额外内容', result.manifest?.extras
              ? (result.manifest.extras.totalFiles + ' 个文件 / ' + fmtBytes(result.manifest.extras.totalBytes)
                 + '（' + Object.keys(result.manifest.extras.kinds || {}).join('、') + '）')
              : '未包含'],
          ].filter(Boolean)
        : null

      const toggleExtra = (key) => {
        setExtras((prev) => ({ ...prev, [key]: !prev[key] }))
      }

      return h(
        'div',
        { className: 'dm' },

        h(
          'div',
          { className: 'dm-head' },
          h('span', { className: 'dm-eyebrow' }, 'dsh-migrate'),
          h(
            'div',
            { className: 'dm-row', style: { justifyContent: 'space-between', alignItems: 'flex-start' } },
            h('h2', { className: 'dm-title' }, '记忆搬家'),
            h('button', {
              className: 'dm-btn dm-btn-ghost',
              style: { padding: '4px 10px', fontSize: '12px' },
              onClick: () => setGuide(0),
              title: '再看一遍新手引导',
            }, '新手引导'),
          ),
          h('p', { className: 'dm-sub' },
            '把这一台 DSH 的插件、配置、会话、记忆打成能搬走的包。到了新电脑，跑一遍包里的 install.ps1 就都回来了。'),
        ),

        guide >= 0
          ? h(GuideCard, {
              step: guide,
              onNext: () => {
                if (guide >= GUIDE_STEPS.length - 1) {
                  markGuideSeen()
                  setGuide(-1)
                } else {
                  setGuide(guide + 1)
                }
              },
              onPrev: () => setGuide(Math.max(0, guide - 1)),
              onClose: () => {
                markGuideSeen()
                setGuide(-1)
              },
            })
          : null,

        h(
          'div',
          { className: 'dm-tabs' },
          h('button', { className: 'dm-tab' + (view === 'beginner' ? ' on' : ''), onClick: () => setView('beginner') }, '新手'),
          h('button', { className: 'dm-tab' + (view === 'expert' ? ' on' : ''), onClick: () => setView('expert') }, '老手'),
        ),

        view === 'beginner'
          ? h(
              'div',
              { className: 'dm-card' },
              h('h4', null, '选个完整度就行'),
              h(
                'div',
                { className: 'dm-choices' },
                Object.entries(PRESET_INFO).map(([key, info]) =>
                  h(
                    'label',
                    { className: 'dm-choice' + (preset === key ? ' on' : ''), key },
                    h('input', { type: 'radio', name: 'dm-preset', checked: preset === key, onChange: () => setPreset(key) }),
                    h('span', null, h('b', null, info.label), h('small', null, info.desc)),
                  )),
              ),
              h('p', { className: 'dm-help' }, '插件、压缩、校验、恢复脚本都由我替你选好。只差一个放包的地方。'),
            )
          : h(
              'div',
              { className: 'dm-card' },
              h('h4', null, '插件怎么打'),
              h(
                'div',
                { className: 'dm-choices' },
                h(
                  'label',
                  { className: 'dm-choice' + (mode === 'lite' ? ' on' : '') },
                  h('input', { type: 'radio', name: 'dm-mode', checked: mode === 'lite', onChange: () => setMode('lite') }),
                  h('span', null, h('b', null, '轻量包'), h('small', null, '几 MB。npm 插件到新电脑再联网装。')),
                ),
                h(
                  'label',
                  { className: 'dm-choice' + (mode === 'full' ? ' on' : '') },
                  h('input', { type: 'radio', name: 'dm-mode', checked: mode === 'full', onChange: () => setMode('full') }),
                  h('span', null, h('b', null, '完整包'), h('small', null, '所有插件打成 tgz，新电脑完全不用联网。')),
                ),
              ),
              h('h4', null, '额外带什么'),
              h(
                'div',
                { className: 'dm-row' },
                Object.entries(EXTRA_INFO).map(([key, label]) =>
                  h(
                    'label',
                    { className: 'dm-check' + (extras[key] ? ' on' : ''), key },
                    h('input', { type: 'checkbox', checked: extras[key] === true, onChange: () => toggleExtra(key) }),
                    h('span', null, label),
                  )),
              ),
              h('p', { className: 'dm-help' }, '配置 = profile 的 package.json 和 patch；会话 = 聊天记录；附件 = 上传的文件；世界 = 房间与日记。'),
            ),

        h(
          'div',
          { className: 'dm-card' },
          h('h4', null, '放到哪'),
          h(
            'div',
            { className: 'dm-row' },
            h('span', { className: 'dm-label' }, '输出位置'),
            h('input', {
              className: 'dm-input',
              placeholder: '可以直接输入路径，也可以点「浏览」选文件夹',
              value: out,
              onChange: (event) => setOut(event.target.value),
            }),
            h('button', { className: 'dm-btn', disabled: !!busy, onClick: browse },
              busy === 'browse' ? '选择中…' : '浏览…'),
          ),
          h('p', { className: 'dm-help' }, '留空 = 默认放到 ~/.dsh/memory-sync/packs/'),
          h(
            'div',
            { className: 'dm-row' },
            h('label', { className: 'dm-check' + (zip ? ' on' : '') },
              h('input', { type: 'checkbox', checked: zip, onChange: (event) => setZip(event.target.checked) }),
              h('span', null, '同时压成 .zip')),
            h('label', { className: 'dm-check' + (includeMemory ? ' on' : '') },
              h('input', { type: 'checkbox', checked: includeMemory, onChange: (event) => setIncludeMemory(event.target.checked) }),
              h('span', null, '带上记忆快照')),
          ),
          h(
            'div',
            { className: 'dm-row' },
            h('button', { className: 'dm-btn dm-btn-primary', disabled: !!busy, onClick: runPack },
              busy === 'pack' ? '打包中…' : '开始打包'),
            h('button', { className: 'dm-btn dm-btn-ghost', disabled: !!busy, onClick: loadPacks }, '刷新已有包'),
          ),
        ),

        error ? h('div', { className: 'dm-err' }, '✗ ' + error) : null,

        summary
          ? h(
              'div',
              { className: 'dm-ok' },
              h('div', null, '✓ 打包完成'),
              ...summary.map(([k, v], i) => h('div', { key: 'k' + i }, h('span', { className: 'dm-k' }, k), v)),
              h('div', { style: { marginTop: '8px', color: 'var(--soft)' } },
                '把整个目录（或 zip）拷到新电脑，先看包里的 README.md，再跑 install.ps1 -DryRun 预演。'),
            )
          : null,

        h(
          'div',
          { className: 'dm-card' },
          h('h4', null, '已有的包'),
          packs.length
            ? h('div', { className: 'dm-packs' },
                packs.slice(0, 12).map((item) =>
                  h('div', { className: 'dm-pack', key: item.id },
                    h('b', null, item.mode === 'full' ? '完整包' : '轻量包'),
                    ' · ' + item.plugins + ' 个插件' + (item.memory ? ' · 带记忆' : '') + ' · ' + (item.createdAt || '').replace('T', ' ').slice(0, 16),
                    h('br'),
                    item.path)))
            : h('div', { className: 'dm-empty' }, '还没有打过包。点上方的「开始打包」。'),
        ),
      )
    }

    const inject = ['slots']
    const NS = 'migrate'

    function apply(ctx) {
      ctx.effect(
        () =>
          ctx.slots.inject('settings.section', () =>
            ctx.slots.register(
              { name: 'settings.section', id: NS, order: 9, label: () => '记忆搬家' },
              MigrateSection,
            ),
            'dsh-migrate: settings section',
          ),
        'dsh-migrate: settings section',
      )
    }

    exports.apply = apply
    exports.inject = inject
    exports.MigrateSection = MigrateSection
    return module.exports
  },
})
