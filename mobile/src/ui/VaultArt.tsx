import { memo } from 'react';
import Svg, {
  Circle,
  ClipPath,
  Defs,
  G,
  Line,
  LinearGradient,
  Path,
  RadialGradient,
  Rect,
  Stop,
  Text,
  TextPath,
} from 'react-native-svg';

/**
 * Static paintings of the vault door's parts, in SVG so the steel gets real
 * gradients. Each part is drawn in its own base units (viewBox) and scaled by
 * `size`; the moving parts (wheel, dial, bolts) are animated by their parent.
 * Light comes from the top left.
 */

const rad = (deg: number) => ((deg - 90) * Math.PI) / 180;
const polar = (r: number, deg: number) => ({ x: r * Math.cos(rad(deg)), y: r * Math.sin(rad(deg)) });

/** Steel frame around the door: brushed plate, inset panel, collar and the dark hole. 236 units wide. */
export const FrameArt = memo(function FrameArt({ size }: { size: number }) {
  const W = 236;
  const c = W / 2;
  const corners = [
    [1, 1],
    [-1, 1],
    [1, -1],
    [-1, -1],
  ] as const;
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${W} ${W}`}>
      <Defs>
        <LinearGradient id="frBody" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#434A50" />
          <Stop offset="0.45" stopColor="#262B2F" />
          <Stop offset="1" stopColor="#0F1214" />
        </LinearGradient>
        <LinearGradient id="frRaised" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#8A9299" />
          <Stop offset="0.5" stopColor="#2E3337" />
          <Stop offset="1" stopColor="#050607" />
        </LinearGradient>
        <LinearGradient id="frSunk" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#030404" />
          <Stop offset="0.5" stopColor="#202427" />
          <Stop offset="1" stopColor="#6E767D" />
        </LinearGradient>
        <RadialGradient id="frHole" cx="0.5" cy="0.5" r="0.5">
          <Stop offset="0" stopColor="#0B0C0D" />
          <Stop offset="0.8" stopColor="#050606" />
          <Stop offset="1" stopColor="#000000" />
        </RadialGradient>
        <RadialGradient id="frRivet" cx="0.35" cy="0.3" r="0.8">
          <Stop offset="0" stopColor="#B4BBC1" />
          <Stop offset="0.45" stopColor="#4A5056" />
          <Stop offset="1" stopColor="#0E1012" />
        </RadialGradient>
        <ClipPath id="frClip">
          <Rect x="0" y="0" width={W} height={W} rx="22" />
        </ClipPath>
      </Defs>

      <Rect x="0.75" y="0.75" width={W - 1.5} height={W - 1.5} rx="22" fill="url(#frBody)" />
      {/* Brushed grain. */}
      <G clipPath="url(#frClip)">
        {Array.from({ length: 79 }, (_, i) => (
          <Line
            key={i}
            x1="0"
            x2={W}
            y1={i * 3 + 1}
            y2={i * 3 + 1}
            stroke={i % 2 ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.14)'}
            strokeWidth="1"
          />
        ))}
      </G>
      <Rect x="0.75" y="0.75" width={W - 1.5} height={W - 1.5} rx="22" fill="none" stroke="url(#frRaised)" strokeWidth="1.5" />
      {/* Inset panel groove. */}
      <Rect x="7" y="7" width={W - 14} height={W - 14} rx="16" fill="none" stroke="url(#frSunk)" strokeWidth="1.2" />

      {/* Raised collar around the opening, then the opening itself with a sunk lip. */}
      <Circle cx={c} cy={c} r="112" fill="rgba(0,0,0,0.25)" stroke="url(#frRaised)" strokeWidth="2.5" />
      <Circle cx={c} cy={c} r="106" fill="url(#frHole)" />
      <Circle cx={c} cy={c} r="105.5" fill="none" stroke="url(#frSunk)" strokeWidth="2.5" />

      {/* Corner rivets and screws. */}
      {corners.map(([sx, sy], ci) =>
        [
          [125, 45],
          [123, 34],
          [123, 56],
        ].map(([r, a], i) => {
          const x = c + sx * r * Math.cos((a * Math.PI) / 180);
          const y = c + sy * r * Math.sin((a * Math.PI) / 180);
          return (
            <G key={`${ci}-${i}`}>
              <Circle cx={x + 0.6} cy={y + 0.9} r="2.6" fill="rgba(0,0,0,0.6)" />
              <Circle cx={x} cy={y} r="2.4" fill="url(#frRivet)" />
            </G>
          );
        }),
      )}
      {corners.map(([sx, sy], i) => {
        const x = sx > 0 ? W - 15 : 15;
        const y = sy > 0 ? W - 15 : 15;
        return (
          <G key={`s${i}`} transform={`translate(${x} ${y}) rotate(${20 + i * 37})`}>
            <Circle cx="0.7" cy="1" r="5.2" fill="rgba(0,0,0,0.6)" />
            <Circle r="5" fill="url(#frRivet)" />
            <Line x1="-3" x2="3" y1="0" y2="0" stroke="#0A0B0C" strokeWidth="1.1" />
            <Line x1="0" x2="0" y1="-3" y2="3" stroke="#0A0B0C" strokeWidth="1.1" />
          </G>
        );
      })}
    </Svg>
  );
});

/** Door face: turned (concentric) steel, a raised band with rivets and the maker's engraving. 186 units. */
export const DoorFaceArt = memo(function DoorFaceArt({ size }: { size: number }) {
  const R = 93;
  const rivets = Array.from({ length: 24 }, (_, i) => i * 15).filter((a) => Math.abs(a - 180) > 50);
  return (
    <Svg width={size} height={size} viewBox={`${-R} ${-R} ${2 * R} ${2 * R}`}>
      <Defs>
        <RadialGradient id="dfBody" cx="-30" cy="-36" r="150" gradientUnits="userSpaceOnUse">
          <Stop offset="0" stopColor="#525A61" />
          <Stop offset="0.5" stopColor="#2A2F33" />
          <Stop offset="1" stopColor="#131618" />
        </RadialGradient>
        <LinearGradient id="dfRaised" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#A2AAB1" />
          <Stop offset="0.5" stopColor="#30363A" />
          <Stop offset="1" stopColor="#050607" />
        </LinearGradient>
        <LinearGradient id="dfSunk" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#050607" />
          <Stop offset="0.5" stopColor="#24292C" />
          <Stop offset="1" stopColor="#7A828A" />
        </LinearGradient>
        <RadialGradient id="dfRivet" cx="0.35" cy="0.3" r="0.8">
          <Stop offset="0" stopColor="#C2C8CD" />
          <Stop offset="0.45" stopColor="#50575D" />
          <Stop offset="1" stopColor="#0E1012" />
        </RadialGradient>
        <RadialGradient id="dfSeat" cx="0.5" cy="0.5" r="0.5">
          <Stop offset="0.7" stopColor="#0C0E0F" />
          <Stop offset="1" stopColor="#1C2023" />
        </RadialGradient>
        <Path id="dfArc" d="M -84 0 A 84 84 0 0 0 84 0" />
      </Defs>

      <Circle r={R - 0.5} fill="url(#dfBody)" />
      {/* Lathe marks. */}
      {Array.from({ length: 34 }, (_, i) => (
        <Circle
          key={i}
          r={14 + i * 2.2}
          fill="none"
          stroke={i % 2 ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.13)'}
          strokeWidth="1"
        />
      ))}
      <Circle r={R - 1.5} fill="none" stroke="url(#dfRaised)" strokeWidth="3" />
      {/* Step down from the outer band to the centre field. */}
      <Circle r="79" fill="none" stroke="rgba(0,0,0,0.45)" strokeWidth="1.2" />
      <Circle r="77.8" fill="none" stroke="url(#dfSunk)" strokeWidth="1.6" />

      {rivets.map((a) => {
        const { x, y } = polar(85, a);
        return (
          <G key={a}>
            <Circle cx={x + 0.5} cy={y + 0.8} r="2.3" fill="rgba(0,0,0,0.55)" />
            <Circle cx={x} cy={y} r="2.1" fill="url(#dfRivet)" />
          </G>
        );
      })}

      {/* Engraving: a lit lower edge under a dark cut. */}
      {[
        { dy: 0.5, fill: 'rgba(255,255,255,0.14)' },
        { dy: 0, fill: 'rgba(0,0,0,0.75)' },
      ].map(({ dy, fill }) => (
        <G key={dy} transform={`translate(0 ${dy})`}>
          <Text fill={fill} fontSize="5.6" fontWeight="700" letterSpacing="2.2" textAnchor="middle">
            <TextPath href="#dfArc" startOffset="50%">
              BASESECRÈTE · N° 7016
            </TextPath>
          </Text>
        </G>
      ))}

      {/* Seat the combination dial sits in. */}
      <Circle r="47" fill="url(#dfSeat)" stroke="url(#dfSunk)" strokeWidth="1.5" />
    </Svg>
  );
});

/** Three-spoke handwheel with knobs, 150 units. `shadow` paints its silhouette, for the drop shadow. */
export const WheelArt = memo(function WheelArt({ size, shadow }: { size: number; shadow?: boolean }) {
  const R = 75;
  const ink = (paint: string) => (shadow ? '#000000' : paint);
  return (
    <Svg width={size} height={size} viewBox={`${-R} ${-R} ${2 * R} ${2 * R}`}>
      <Defs>
        <LinearGradient id="whSpoke" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#A9B0B6" />
          <Stop offset="0.35" stopColor="#5A6168" />
          <Stop offset="1" stopColor="#15181A" />
        </LinearGradient>
        <RadialGradient id="whKnob" cx="0.35" cy="0.3" r="0.85">
          <Stop offset="0" stopColor="#D5DADE" />
          <Stop offset="0.35" stopColor="#6A7178" />
          <Stop offset="1" stopColor="#101214" />
        </RadialGradient>
      </Defs>
      {[0, 60, 120].map((a) => (
        <G key={a} transform={`rotate(${a})`}>
          <Rect x="-66" y="-4" width="132" height="8" rx="4" fill={ink('url(#whSpoke)')} />
          {[-66, 66].map((x) => (
            <G key={x}>
              <Circle cx={x} cy="0" r="9.5" fill={ink('url(#whKnob)')} />
              {shadow ? null : <Circle cx={x} cy="0" r="5.5" fill="none" stroke="rgba(0,0,0,0.35)" strokeWidth="0.8" />}
            </G>
          ))}
        </G>
      ))}
    </Svg>
  );
});

/** Combination dial: knurled bezel, 100 graduations, numbers every 10, grip in the middle. 84 units. */
export const DialArt = memo(function DialArt({ size }: { size: number }) {
  const R = 42;
  return (
    <Svg width={size} height={size} viewBox={`${-R} ${-R} ${2 * R} ${2 * R}`}>
      <Defs>
        <LinearGradient id="diBezel" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#7E868D" />
          <Stop offset="0.5" stopColor="#30363A" />
          <Stop offset="1" stopColor="#0C0E0F" />
        </LinearGradient>
        <RadialGradient id="diFace" cx="0.5" cy="0.5" r="0.5">
          <Stop offset="0" stopColor="#30363B" />
          <Stop offset="1" stopColor="#1A1E21" />
        </RadialGradient>
        <RadialGradient id="diGrip" cx="0.35" cy="0.3" r="0.8">
          <Stop offset="0" stopColor="#8D959C" />
          <Stop offset="0.5" stopColor="#3A4046" />
          <Stop offset="1" stopColor="#0F1113" />
        </RadialGradient>
      </Defs>
      <Circle r={R - 0.5} fill="url(#diBezel)" />
      {Array.from({ length: 90 }, (_, i) => {
        const a = polar(37.5, i * 4);
        const b = polar(41.5, i * 4);
        return <Line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="rgba(0,0,0,0.5)" strokeWidth="0.8" />;
      })}
      <Circle r="37" fill="url(#diFace)" stroke="#0A0B0C" strokeWidth="0.8" />
      {Array.from({ length: 100 }, (_, i) => {
        const major = i % 10 === 0;
        const mid = i % 5 === 0;
        const a = polar(35.8, i * 3.6);
        const b = polar(major ? 30 : mid ? 32.3 : 33.8, i * 3.6);
        return (
          <Line
            key={i}
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            stroke={major ? '#E4E8EB' : mid ? '#A3AAB0' : '#6B7278'}
            strokeWidth={major ? 1.1 : mid ? 0.8 : 0.5}
          />
        );
      })}
      {Array.from({ length: 10 }, (_, i) => (
        <G key={i} transform={`rotate(${i * 36})`}>
          <Text y="-23" fill="#CDD2D6" fontSize="6.2" fontWeight="700" textAnchor="middle">
            {i * 10}
          </Text>
        </G>
      ))}
      {/* Grip. */}
      <Circle cx="0.6" cy="1" r="14" fill="rgba(0,0,0,0.5)" />
      <Circle r="13.5" fill="url(#diGrip)" />
      {Array.from({ length: 6 }, (_, i) => (
        <G key={i} transform={`rotate(${i * 60})`}>
          <Rect x="-1.6" y="-13" width="3.2" height="6" rx="1.6" fill="rgba(0,0,0,0.35)" />
        </G>
      ))}
      <Circle r="5" fill="none" stroke="rgba(0,0,0,0.35)" strokeWidth="0.8" />
    </Svg>
  );
});

/** Light falling on the dial: drawn on top and never rotated, so the reflection stays put as the dial turns. */
export const DialGloss = memo(function DialGloss({ size }: { size: number }) {
  return (
    <Svg width={size} height={size} viewBox="-42 -42 84 84">
      <Defs>
        <RadialGradient id="dgGloss" cx="0.3" cy="0.22" r="0.65">
          <Stop offset="0" stopColor="#FFFFFF" stopOpacity="0.22" />
          <Stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
        </RadialGradient>
      </Defs>
      <Circle r="41.5" fill="url(#dgGloss)" />
      <Path d="M -36 -12 A 38 38 0 0 1 12 -36" fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="0.8" strokeLinecap="round" />
    </Svg>
  );
});

/** Locking bolt: a steel cylinder seen from above. 12 × 24 units. */
export const BoltArt = memo(function BoltArt({ width, height }: { width: number; height: number }) {
  return (
    <Svg width={width} height={height} viewBox="0 0 12 24">
      <Defs>
        <LinearGradient id="boBody" x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor="#1A1D20" />
          <Stop offset="0.3" stopColor="#B8BFC5" />
          <Stop offset="0.55" stopColor="#5A6168" />
          <Stop offset="1" stopColor="#0E1012" />
        </LinearGradient>
      </Defs>
      <Rect x="0.5" y="0.5" width="11" height="23" rx="3" fill="url(#boBody)" stroke="#050607" strokeWidth="0.6" />
      <Rect x="2" y="1.4" width="8" height="1.4" rx="0.7" fill="rgba(255,255,255,0.3)" />
    </Svg>
  );
});

/** Door hinge: two knuckles on a vertical pin. 14 × 44 units. */
export const HingeArt = memo(function HingeArt({ width, height }: { width: number; height: number }) {
  return (
    <Svg width={width} height={height} viewBox="0 0 14 44">
      <Defs>
        <LinearGradient id="hiBody" x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor="#15181A" />
          <Stop offset="0.35" stopColor="#A9B0B6" />
          <Stop offset="0.6" stopColor="#4A5056" />
          <Stop offset="1" stopColor="#0A0B0C" />
        </LinearGradient>
      </Defs>
      <Rect x="0.5" y="0.5" width="13" height="20.5" rx="3.5" fill="url(#hiBody)" stroke="#050607" strokeWidth="0.6" />
      <Rect x="0.5" y="23" width="13" height="20.5" rx="3.5" fill="url(#hiBody)" stroke="#050607" strokeWidth="0.6" />
      <Rect x="5.5" y="20" width="3" height="4" fill="#2A2F33" />
    </Svg>
  );
});

/** Soft round light: a colour fading out from the centre. */
export const Glow = memo(function Glow({ size, color, strength = 1 }: { size: number; color: string; strength?: number }) {
  const id = `gl${color.replace(/[^a-z0-9]/gi, '')}`;
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Defs>
        <RadialGradient id={id} cx="0.5" cy="0.5" r="0.5">
          <Stop offset="0" stopColor={color} stopOpacity={strength} />
          <Stop offset="0.4" stopColor={color} stopOpacity={strength * 0.45} />
          <Stop offset="1" stopColor={color} stopOpacity="0" />
        </RadialGradient>
      </Defs>
      <Circle cx="50" cy="50" r="50" fill={`url(#${id})`} />
    </Svg>
  );
});

/** Diagonal glint that sweeps across the door to invite a tap. */
export const SheenBand = memo(function SheenBand({ width, height }: { width: number; height: number }) {
  return (
    <Svg width={width} height={height} viewBox="0 0 10 10" preserveAspectRatio="none">
      <Defs>
        <LinearGradient id="shBand" x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor="#FFFFFF" stopOpacity="0" />
          <Stop offset="0.5" stopColor="#FFFFFF" stopOpacity="0.16" />
          <Stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
        </LinearGradient>
      </Defs>
      <Rect width="10" height="10" fill="url(#shBand)" />
    </Svg>
  );
});
