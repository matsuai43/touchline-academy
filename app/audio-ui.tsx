'use client';
// TOUCHLINE ACADEMY v3 — W7: BGM/SE の設定UI
//
// 単体で完結するコンポーネント。lib/audio.ts の公開APIのみに依存し、
// game-ui.tsx など他のファイルは一切触らない。統括側が既存の「保存・設定」
// ダイアログ（app/game-ui.tsx の settings Dialog）の中に <AudioSettingsPanel />
// を差し込むだけで配線できるように作ってある。
//
// スタイルは Tailwind ユーティリティクラスのみで完結させており、
// globals.css の既存セレクタには一切依存しない。

import { useCallback, useEffect, useState } from 'react';
import { Music2, Volume2, VolumeX } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import {
  getAudioSettings,
  setAudioSettings,
  subscribeAudioSettings,
  primeAudio,
  playSfx,
  isAudioSupported,
  type AudioSettings,
} from '@/lib/audio';

/**
 * lib/audio.ts の設定を React state として購読するフック。
 * 独自の音量UIを作りたい場合はこれを使う。
 */
export function useAudioSettings(): [
  AudioSettings,
  (patch: Partial<AudioSettings>) => void,
] {
  const [state, setState] = useState<AudioSettings>(() => getAudioSettings());
  useEffect(() => subscribeAudioSettings(setState), []);
  const update = useCallback((patch: Partial<AudioSettings>) => {
    setAudioSettings(patch);
  }, []);
  return [state, update];
}

function pct(v: number): number {
  return Math.round(v * 100);
}

type RowProps = {
  icon: React.ReactNode;
  label: string;
  desc: string;
  on: boolean;
  volume: number;
  onToggle: (on: boolean) => void;
  onVolume: (v: number) => void;
  onPreview?: () => void;
  previewLabel?: string;
};

function AudioRow({
  icon,
  label,
  desc,
  on,
  volume,
  onToggle,
  onVolume,
  onPreview,
  previewLabel,
}: RowProps) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border/60 bg-muted/20 p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="shrink-0 text-muted-foreground" aria-hidden="true">
            {icon}
          </span>
          <div className="min-w-0">
            <div className="text-sm font-medium leading-tight">{label}</div>
            <div className="text-xs text-muted-foreground leading-tight">{desc}</div>
          </div>
        </div>
        <Switch
          checked={on}
          onCheckedChange={(checked) => {
            // ユーザー操作（この切り替え）を起点に AudioContext を起動・再開する。
            primeAudio();
            onToggle(checked);
          }}
          aria-label={`${label}を${on ? 'オフ' : 'オン'}にする`}
        />
      </div>
      <div className="flex items-center gap-3 pl-7">
        <Slider
          className="flex-1"
          value={pct(volume)}
          min={0}
          max={100}
          step={5}
          disabled={!on}
          onValueChange={(v) => onVolume((Array.isArray(v) ? v[0] : v) / 100)}
          aria-label={`${label}の音量`}
        />
        <span className="w-10 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
          {pct(volume)}%
        </span>
        {onPreview && (
          <button
            type="button"
            className="shrink-0 rounded-md border border-border/60 px-2 py-1 text-xs text-muted-foreground hover:bg-muted/40 disabled:opacity-40 disabled:pointer-events-none"
            disabled={!on}
            onClick={() => {
              primeAudio();
              onPreview();
            }}
          >
            {previewLabel ?? '試聴'}
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * BGM・効果音の ON/OFF と音量スライダーをまとめた設定パネル。
 * 既存の「保存・設定」ダイアログの中に差し込んで使う想定
 * （<Dialog> や <DialogContent> は含まない、中身だけのコンポーネント）。
 */
export function AudioSettingsPanel({ className }: { className?: string }) {
  const [settings, update] = useAudioSettings();
  const [supported] = useState(() => isAudioSupported());

  return (
    <div className={`flex flex-col gap-3 ${className ?? ''}`}>
      <AudioRow
        icon={<Music2 size={18} />}
        label="BGM"
        desc="場面に合わせて自動再生します"
        on={settings.bgmOn}
        volume={settings.bgmVolume}
        onToggle={(on) => update({ bgmOn: on })}
        onVolume={(v) => update({ bgmVolume: v })}
      />
      <AudioRow
        icon={settings.seOn ? <Volume2 size={18} /> : <VolumeX size={18} />}
        label="効果音"
        desc="ボタン・ホイッスル・ゴールなど"
        on={settings.seOn}
        volume={settings.seVolume}
        onToggle={(on) => update({ seOn: on })}
        onVolume={(v) => update({ seVolume: v })}
        onPreview={() => playSfx('whistle')}
        previewLabel="試聴"
      />
      <p className="text-xs text-muted-foreground leading-relaxed">
        音はすべてこの端末上でリアルタイムに合成しています。音源ファイルは一切使用していません。
        既定はオフです。オンにすると、この操作をきっかけに音が有効になります。
        {!supported &&
          '（この端末・ブラウザでは音声合成に対応していないため、オンにしても無音のままです）'}
      </p>
    </div>
  );
}

export default AudioSettingsPanel;
