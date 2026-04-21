import React, { useState } from 'react';
import { 
  Palette, 
  Cpu, 
  Eye, 
  EyeOff, 
  Check, 
  Sun, 
  Moon, 
  Monitor,
  ChevronDown,
  Save,
  MemoryStick
} from 'lucide-react';
import { cn } from '@/src/lib/utils';

export const Settings: React.FC = () => {
  const [theme, setTheme] = useState<'light' | 'dark' | 'system'>('light');
  const [showKey, setShowKey] = useState(false);
  const [provider, setProvider] = useState('openai');
  const [model, setModel] = useState('gpt-4o');

  const themes = [
    { id: 'light', label: '浅色模式', icon: Sun },
    { id: 'dark', label: '深色模式', icon: Moon },
    { id: 'system', label: '跟随系统', icon: Monitor },
  ] as const;

  return (
    <div className="max-w-7xl mx-auto space-y-12">
      {/* Page Header */}
      <div className="flex flex-col gap-3">
        <h1 className="text-5xl font-[800] font-headline text-primary tracking-tighter">设置</h1>
        <p className="font-medium text-on-surface-variant max-w-xl text-lg">
          管理您的金融终端偏好、外观以及 AI 模型推理配置。
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-start">
        {/* Left Column: Appearance */}
        <div className="lg:col-span-5 flex flex-col gap-10">
          <section className="bg-surface-container-lowest rounded-[2rem] p-10 shadow-sm border border-outline-variant/10">
            <h2 className="text-2xl font-[800] font-headline text-primary mb-8 flex items-center gap-3">
              <Palette className="text-primary" size={24} />
              外观体验
            </h2>
            <p className="text-sm font-medium text-on-surface-variant mb-10 leading-relaxed">
              根据您的工作习惯选择最舒适的界面视觉呈现。高动态范围支持与色弱优化已默认开启。
            </p>

            <div className="grid grid-cols-3 gap-6">
              {themes.map((t) => (
                <button 
                  key={t.id}
                  onClick={() => setTheme(t.id)}
                  className="flex flex-col items-center gap-4 group cursor-pointer outline-none"
                >
                  <div className={cn(
                    "w-full aspect-[4/3] rounded-2xl transition-all duration-300 relative sm:p-2.5 p-1.5",
                    "border-2 flex flex-col overflow-hidden",
                    theme === t.id 
                      ? "border-primary shadow-lg shadow-primary/5 bg-surface-container-low" 
                      : "border-transparent bg-surface-container-highest/30 hover:border-outline-variant/50"
                  )}>
                    {t.id === 'light' && (
                      <div className="w-full h-full flex flex-col gap-1 sm:gap-2">
                        <div className="h-1/5 bg-surface-container-highest rounded-md" />
                        <div className="flex-1 flex gap-2">
                          <div className="w-1/4 h-full bg-surface-container-highest rounded-md" />
                          <div className="flex-1 h-full bg-surface rounded-md" />
                        </div>
                      </div>
                    )}
                    {t.id === 'dark' && (
                      <div className="w-full h-full flex flex-col gap-1 sm:gap-2">
                        <div className="h-1/5 bg-on-surface rounded-md" />
                        <div className="flex-1 flex gap-2">
                          <div className="w-1/4 h-full bg-on-surface-variant/20 rounded-md" />
                          <div className="flex-1 h-full bg-on-surface/80 rounded-md" />
                        </div>
                      </div>
                    )}
                    {t.id === 'system' && (
                      <div className="w-full h-full bg-gradient-to-br from-surface-container-highest to-on-surface rounded-md flex items-center justify-center">
                        <Monitor size={24} className="text-on-surface-variant/40" />
                      </div>
                    )}

                    {theme === t.id && (
                      <div className="absolute bottom-2 right-2 w-6 h-6 bg-tertiary-fixed text-primary rounded-full flex items-center justify-center shadow-md animate-in zoom-in-50 duration-300">
                        <Check size={14} className="stroke-[4px]" />
                      </div>
                    )}
                  </div>
                  <span className={cn(
                    "text-[10px] font-black uppercase tracking-widest transition-colors",
                    theme === t.id ? "text-primary" : "text-on-surface-variant"
                  )}>
                    {t.label}
                  </span>
                </button>
              ))}
            </div>
          </section>
        </div>

        {/* Right Column: AI Config */}
        <div className="lg:col-span-7 flex flex-col gap-10">
          <section className="bg-surface-container-lowest rounded-[2rem] p-10 shadow-sm border border-outline-variant/10 relative overflow-hidden group">
            <div className="absolute top-0 right-0 w-64 h-64 bg-primary/5 rounded-full blur-[100px] -mr-32 -mt-32 pointer-events-none group-hover:scale-125 transition-transform duration-1000" />
            
            <h2 className="text-2xl font-[800] font-headline text-primary mb-10 flex items-center gap-3">
              <Cpu className="text-primary" size={24} />
              LLM 模型集群配置
            </h2>

            <div className="space-y-10 relative">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                {/* Provider Select */}
                <div className="flex flex-col">
                  <label className="text-[10px] font-black text-on-surface-variant uppercase tracking-[0.2em] mb-4 flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-primary" />
                    云端供应商 (Provider)
                  </label>
                  <div className="relative group">
                    <select 
                      value={provider}
                      onChange={(e) => setProvider(e.target.value)}
                      className="w-full bg-surface-container-highest/50 border-b-2 border-outline/20 outline-none rounded-t-2xl px-5 py-4 font-bold text-sm text-primary hover:bg-surface-container-highest transition-all appearance-none cursor-pointer focus:border-primary"
                    >
                      <option value="openai">OpenAI (Primary)</option>
                      <option value="gemini">Google Gemini 3.0</option>
                      <option value="anthropic">Anthropic Claude</option>
                      <option value="deepseek">DeepSeek R1</option>
                    </select>
                    <ChevronDown size={18} className="absolute right-5 top-1/2 -translate-y-1/2 text-on-surface-variant pointer-events-none group-hover:text-primary transition-colors" />
                  </div>
                </div>

                {/* Model Select */}
                <div className="flex flex-col">
                  <label className="text-[10px] font-black text-on-surface-variant uppercase tracking-[0.2em] mb-4 flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-tertiary-fixed" />
                    推理引擎版本 (Model)
                  </label>
                  <div className="relative group">
                    <select 
                      value={model}
                      onChange={(e) => setModel(e.target.value)}
                      className="w-full bg-surface-container-highest/50 border-b-2 border-outline/20 outline-none rounded-t-2xl px-5 py-4 font-bold text-sm text-primary hover:bg-surface-container-highest transition-all appearance-none cursor-pointer focus:border-primary"
                    >
                      <option value="gpt-4o">GPT-4o Omniscience</option>
                      <option value="gemini-3-flash">Gemini 3 Flash Preview</option>
                      <option value="claude-3-5">Claude 3.5 Sonnet</option>
                      <option value="r1">R1 DeepSeek Pro</option>
                    </select>
                    <ChevronDown size={18} className="absolute right-5 top-1/2 -translate-y-1/2 text-on-surface-variant pointer-events-none group-hover:text-primary transition-colors" />
                  </div>
                </div>
              </div>

              {/* API Key Input */}
              <div className="flex flex-col">
                <label className="text-[10px] font-black text-on-surface-variant uppercase tracking-[0.2em] mb-4">
                  企业级 API 许可证密钥 (Security Key)
                </label>
                <div className="relative flex items-center group">
                  <input 
                    type={showKey ? "text" : "password"} 
                    placeholder="sk-••••••••••••••••••••••••••••••••"
                    className="w-full bg-surface-container-highest/50 border-b-2 border-outline/20 outline-none rounded-t-2xl px-5 py-4 font-mono text-sm text-primary focus:border-primary transition-all pr-14"
                  />
                  <button 
                    onClick={() => setShowKey(!showKey)}
                    className="absolute right-5 p-1 text-on-surface-variant hover:text-primary transition-colors outline-none"
                  >
                    {showKey ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
                <p className="text-[10px] font-medium text-on-surface-variant/60 mt-3 px-1 italic">
                  * 密钥已采用企业级硬件 HSM 加密存储。
                </p>
              </div>

              <div className="pt-10 border-t border-surface-container flex items-center justify-between">
                <div className="flex items-center gap-3 text-tertiary-container">
                  <MemoryStick size={16} />
                  <span className="text-[10px] font-black uppercase tracking-widest leading-none">推理集群负载: 正常 (1.2ms latency)</span>
                </div>
                <button className="flex items-center gap-3 px-10 py-4 bg-primary text-surface rounded-2xl font-[800] font-headline text-base shadow-xl shadow-primary/20 hover:scale-[1.02] active:scale-[0.98] transition-all">
                  <Save size={20} className="stroke-[3px]" />
                  保存并重启集群
                </button>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};
