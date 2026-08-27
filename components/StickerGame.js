import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  SafeAreaView,
  StatusBar,
  Animated,
  PanResponder,
  Platform,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import Svg, {
  Rect,
  Path,
  Ellipse,
  Defs,
  LinearGradient as SvgGradient,
  RadialGradient,
  Stop,
  Line,
} from 'react-native-svg';

const { width, height } = Dimensions.get('window');

// Heebo is served via Google Fonts on web; native uses the system stack,
// which renders Hebrew cleanly on both platforms
const FONT = Platform.OS === 'web' ? 'Heebo, -apple-system, sans-serif' : undefined;

const PRODUCT_H = Math.min(height * 0.46, 420);
const PRODUCT_W = PRODUCT_H / 2; // bottle viewBox is 120x240

// ---------- Theme ----------

const C = {
  bgTop: '#211B1E',
  bgBottom: '#141117',
  surface: 'rgba(255,255,255,0.05)',
  surfaceBorder: 'rgba(255,255,255,0.08)',
  text: '#F5F1EC',
  muted: 'rgba(245,241,236,0.55)',
  faint: 'rgba(245,241,236,0.32)',
  red: '#B3271E',
  redBright: '#D8402F',
  gold: '#D9A441',
  paper: '#FAF6EE',
  ink: '#2E2A26',
};

// ---------- Level data ----------

const SLOT_SIZES = {
  neck: { w: PRODUCT_W * 0.5, h: 26 },
  label: { w: PRODUCT_W * 0.56, h: 88 },
  weight: { w: 84, h: 32 },
  stamp: { w: 48, h: 48 },
  barcode: { w: 64, h: 40 },
};

const SLOTS = [
  { id: 'neck', kind: 'neck', hint: 'סרט צוואר', top: 0.355 },
  { id: 'label', kind: 'label', hint: 'תווית ראשית', top: 0.44 },
  { id: 'weight', kind: 'weight', hint: 'משקל נטו', top: 0.705 },
  { id: 'stamp', kind: 'stamp', hint: 'חותמת', top: 0.8, left: 0.21 },
  { id: 'barcode', kind: 'barcode', hint: 'ברקוד', top: 0.81, left: 0.47 },
];

const STICKERS = [
  { id: 's-neck', kind: 'neck', variant: 'ketchup', slot: 'neck' },
  { id: 's-label', kind: 'label', variant: 'ketchup', slot: 'label' },
  { id: 's-weight', kind: 'weight', variant: 'g750', slot: 'weight' },
  { id: 's-stamp', kind: 'stamp', variant: 'kosher', slot: 'stamp' },
  { id: 's-barcode', kind: 'barcode', variant: 'real', slot: 'barcode' },
  { id: 'd-neck', kind: 'neck', variant: 'mustard', slot: null },
  { id: 'd-weight', kind: 'weight', variant: 'liter', slot: null },
  { id: 'd-stamp', kind: 'stamp', variant: 'organic', slot: null },
];

const CORRECT_COUNT = STICKERS.filter((s) => s.slot).length;

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------- Label piece renderers (shared by tray and bottle) ----------

function NeckBand({ variant }) {
  const mustard = variant === 'mustard';
  return (
    <View
      style={[
        pieces.neck,
        { backgroundColor: mustard ? C.gold : C.red },
      ]}
    >
      <Text style={[pieces.neckText, mustard && { color: '#42340F' }]}>
        {mustard ? 'חרדל' : 'מתכון מקורי'}
      </Text>
    </View>
  );
}

function MainLabel() {
  return (
    <View style={pieces.label}>
      <View style={pieces.labelRule} />
      <Text style={pieces.labelTitle}>קטשופ</Text>
      <Text style={pieces.labelSub}>רסק עגבניות טבעי</Text>
      <View style={pieces.labelRule} />
    </View>
  );
}

function WeightPill({ variant }) {
  return (
    <View style={pieces.pill}>
      <Text style={pieces.pillText}>{variant === 'liter' ? '1 ליטר' : '750 גרם'}</Text>
    </View>
  );
}

function Stamp({ variant }) {
  const organic = variant === 'organic';
  return (
    <View style={[pieces.stamp, organic && { borderColor: '#4E7A4E' }]}>
      <Text style={[pieces.stampText, organic && { color: '#4E7A4E' }]}>
        {organic ? 'אורגני' : 'כשר'}
      </Text>
      {!organic && <Text style={pieces.stampSub}>למהדרין</Text>}
    </View>
  );
}

const BARCODE_BARS = [2, 1, 3, 1, 2, 2, 1, 3, 2, 1, 2, 3, 1, 2, 1, 2];

function Barcode() {
  return (
    <View style={pieces.barcode}>
      <View style={pieces.barcodeRow}>
        {BARCODE_BARS.map((w, i) => (
          <View key={i} style={{ width: w, backgroundColor: '#191713', alignSelf: 'stretch', marginRight: 1.5 }} />
        ))}
      </View>
      <Text style={pieces.barcodeText}>7 290000 528113</Text>
    </View>
  );
}

function PieceContent({ sticker }) {
  switch (sticker.kind) {
    case 'neck':
      return <NeckBand variant={sticker.variant} />;
    case 'label':
      return <MainLabel />;
    case 'weight':
      return <WeightPill variant={sticker.variant} />;
    case 'stamp':
      return <Stamp variant={sticker.variant} />;
    case 'barcode':
      return <Barcode />;
    default:
      return null;
  }
}

// ---------- Bottle illustration ----------

function KetchupBottle() {
  return (
    <Svg width={PRODUCT_W} height={PRODUCT_H} viewBox="0 0 120 240">
      <Defs>
        <SvgGradient id="body" x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor="#8E1F17" />
          <Stop offset="0.35" stopColor="#B3271E" />
          <Stop offset="0.7" stopColor="#C23425" />
          <Stop offset="1" stopColor="#7C1A13" />
        </SvgGradient>
        <SvgGradient id="cap" x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor="#5E120D" />
          <Stop offset="0.5" stopColor="#8A1E16" />
          <Stop offset="1" stopColor="#4F0F0B" />
        </SvgGradient>
        <RadialGradient id="glow" cx="0.5" cy="0.5" r="0.5">
          <Stop offset="0" stopColor="#D8402F" stopOpacity="0.16" />
          <Stop offset="1" stopColor="#D8402F" stopOpacity="0" />
        </RadialGradient>
      </Defs>

      {/* Ambient glow behind the bottle */}
      <Ellipse cx="60" cy="130" rx="60" ry="110" fill="url(#glow)" />
      {/* Floor shadow */}
      <Ellipse cx="60" cy="234" rx="42" ry="5" fill="#000" opacity="0.4" />

      {/* Cap */}
      <Rect x="44" y="4" width="32" height="26" rx="4" fill="url(#cap)" />
      {[49, 55, 61, 67].map((x) => (
        <Line key={x} x1={x} y1="7" x2={x} y2="27" stroke="#FFF" strokeOpacity="0.08" strokeWidth="2" />
      ))}
      {/* Collar seal */}
      <Rect x="46" y="30" width="28" height="7" rx="2" fill="#6B150F" />

      {/* Body with shoulders */}
      <Path
        d="M48 37 C48 55 26 61 24 86 L24 214 C24 225 32 232 42 232 L78 232 C88 232 96 225 96 214 L96 86 C94 61 72 55 72 37 Z"
        fill="url(#body)"
      />
      {/* Left highlight */}
      <Path
        d="M33 94 C29 132 29 172 33 206"
        stroke="#FFF"
        strokeOpacity="0.12"
        strokeWidth="6"
        strokeLinecap="round"
        fill="none"
      />
      {/* Right edge shade */}
      <Path
        d="M90 92 C93 132 93 174 90 210"
        stroke="#000"
        strokeOpacity="0.18"
        strokeWidth="5"
        strokeLinecap="round"
        fill="none"
      />
    </Svg>
  );
}

// ---------- Drag & drop ----------

const HIT_MARGIN = 16;

function hitTest(rects, x, y) {
  return rects.find(
    (r) =>
      x >= r.x - HIT_MARGIN &&
      x <= r.x + r.w + HIT_MARGIN &&
      y >= r.y - HIT_MARGIN &&
      y <= r.y + r.h + HIT_MARGIN
  );
}

function DraggableSticker({ sticker, onDrop, onDragStart, onDragMove, disabled }) {
  const pan = useRef(new Animated.ValueXY()).current;
  const scale = useRef(new Animated.Value(1)).current;
  const shakeX = useRef(new Animated.Value(0)).current;
  const [dragging, setDragging] = useState(false);

  // PanResponder is created once, so route callbacks through refs to avoid
  // capturing stale props in its closures
  const onDropRef = useRef(onDrop);
  onDropRef.current = onDrop;
  const onDragStartRef = useRef(onDragStart);
  onDragStartRef.current = onDragStart;
  const onDragMoveRef = useRef(onDragMove);
  onDragMoveRef.current = onDragMove;
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;

  const shake = useCallback(() => {
    Animated.sequence([
      Animated.timing(shakeX, { toValue: 7, duration: 45, useNativeDriver: true }),
      Animated.timing(shakeX, { toValue: -7, duration: 45, useNativeDriver: true }),
      Animated.timing(shakeX, { toValue: 4, duration: 45, useNativeDriver: true }),
      Animated.timing(shakeX, { toValue: 0, duration: 45, useNativeDriver: true }),
    ]).start();
  }, [shakeX]);

  const springBack = useCallback(() => {
    Animated.spring(pan, {
      toValue: { x: 0, y: 0 },
      friction: 5,
      useNativeDriver: true,
    }).start();
  }, [pan]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !disabledRef.current,
      onMoveShouldSetPanResponder: (_, g) =>
        !disabledRef.current && (Math.abs(g.dx) > 3 || Math.abs(g.dy) > 3),
      onPanResponderGrant: () => {
        setDragging(true);
        if (Platform.OS !== 'web') {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        }
        onDragStartRef.current();
        Animated.spring(scale, { toValue: 1.08, useNativeDriver: true }).start();
      },
      onPanResponderMove: Animated.event([null, { dx: pan.x, dy: pan.y }], {
        useNativeDriver: false,
        listener: (_, g) => onDragMoveRef.current(g.moveX, g.moveY),
      }),
      onPanResponderRelease: async (_, gesture) => {
        Animated.spring(scale, { toValue: 1, useNativeDriver: true }).start();
        const result = await onDropRef.current(sticker, gesture.moveX, gesture.moveY);
        setDragging(false);
        if (result === 'placed') {
          pan.setValue({ x: 0, y: 0 });
        } else {
          if (result === 'wrong') shake();
          springBack();
        }
      },
      onPanResponderTerminate: () => {
        setDragging(false);
        Animated.spring(scale, { toValue: 1, useNativeDriver: true }).start();
        springBack();
      },
    })
  ).current;

  return (
    <Animated.View
      {...panResponder.panHandlers}
      style={[
        styles.stickerWrap,
        dragging && styles.stickerDragging,
        {
          transform: [
            { translateX: Animated.add(pan.x, shakeX) },
            { translateY: pan.y },
            { scale },
          ],
        },
      ]}
    >
      <PieceContent sticker={sticker} />
    </Animated.View>
  );
}

function PlacedSticker({ sticker }) {
  const pop = useRef(new Animated.Value(0.5)).current;
  useEffect(() => {
    Animated.spring(pop, { toValue: 1, friction: 5, useNativeDriver: true }).start();
  }, [pop]);
  return (
    <Animated.View style={{ transform: [{ scale: pop }] }}>
      <PieceContent sticker={sticker} />
    </Animated.View>
  );
}

// ---------- Main game ----------

function formatTime(s) {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec < 10 ? '0' : ''}${sec}`;
}

export default function StickerGame({ onBack }) {
  const [tray, setTray] = useState(() => shuffle(STICKERS));
  const [placed, setPlaced] = useState({});
  const placedRef = useRef({});
  const [mistakes, setMistakes] = useState(0);
  const [flashSlot, setFlashSlot] = useState(null);
  const [hoverSlot, setHoverSlot] = useState(null);
  const [done, setDone] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const slotRefs = useRef({});
  const dragRects = useRef([]);

  const filledCount = Object.keys(placed).length;

  useEffect(() => {
    if (done) return;
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [done]);

  const measureSlot = (id) =>
    new Promise((resolve) => {
      const ref = slotRefs.current[id];
      if (!ref) return resolve(null);
      ref.measureInWindow((x, y, w, h) => resolve({ id, x, y, w, h }));
    });

  const measureOpenSlots = useCallback(async () => {
    const open = SLOTS.filter((s) => !placedRef.current[s.id]);
    return (await Promise.all(open.map((s) => measureSlot(s.id)))).filter(Boolean);
  }, []);

  const handleDragStart = useCallback(async () => {
    dragRects.current = await measureOpenSlots();
  }, [measureOpenSlots]);

  const handleDragMove = useCallback((x, y) => {
    const hit = hitTest(dragRects.current, x, y);
    const id = hit ? hit.id : null;
    setHoverSlot((prev) => (prev === id ? prev : id));
  }, []);

  const handleDrop = useCallback(
    async (sticker, dropX, dropY) => {
      setHoverSlot(null);
      const rects = await measureOpenSlots();
      const hit = hitTest(rects, dropX, dropY);
      if (!hit) return 'none';

      if (sticker.slot === hit.id) {
        if (Platform.OS !== 'web') {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }
        const nextPlaced = { ...placedRef.current, [hit.id]: sticker };
        placedRef.current = nextPlaced;
        setPlaced(nextPlaced);
        setTray((t) => t.filter((s) => s.id !== sticker.id));
        if (Object.keys(nextPlaced).length === CORRECT_COUNT) {
          setTimeout(() => setDone(true), 500);
        }
        return 'placed';
      }

      if (Platform.OS !== 'web') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
      setMistakes((m) => m + 1);
      setFlashSlot(hit.id);
      setTimeout(() => setFlashSlot(null), 450);
      return 'wrong';
    },
    [measureOpenSlots]
  );

  const restart = () => {
    slotRefs.current = {};
    placedRef.current = {};
    setTray(shuffle(STICKERS));
    setPlaced({});
    setMistakes(0);
    setHoverSlot(null);
    setSeconds(0);
    setDone(false);
  };

  const accuracy = Math.round((CORRECT_COUNT / (CORRECT_COUNT + mistakes)) * 100);
  const stars = mistakes === 0 ? 3 : mistakes <= 2 ? 2 : 1;

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />
      <LinearGradient colors={[C.bgTop, C.bgBottom]} style={styles.background}>
        <SafeAreaView style={styles.safeArea}>
          {/* HUD */}
          <View style={styles.hud}>
            {onBack ? (
              <TouchableOpacity style={styles.backButton} onPress={onBack}>
                <Text style={styles.backText}>חזרה</Text>
              </TouchableOpacity>
            ) : (
              <View style={styles.backButton} />
            )}
            <View style={styles.hudCenter}>
              <Text style={styles.kicker}>משחק המדבקות</Text>
              <Text style={styles.productName}>קטשופ</Text>
            </View>
            <View style={styles.hudRight}>
              <Text style={styles.timer}>{formatTime(seconds)}</Text>
              <Text style={styles.progress}>
                {filledCount}/{CORRECT_COUNT}
              </Text>
            </View>
          </View>

          {/* Product */}
          <View style={styles.productArea}>
            <View style={{ width: PRODUCT_W, height: PRODUCT_H }}>
              <KetchupBottle />
              {SLOTS.map((slot) => {
                const size = SLOT_SIZES[slot.kind];
                const filled = placed[slot.id];
                const isFlash = flashSlot === slot.id;
                const isHover = hoverSlot === slot.id && !filled;
                const left =
                  slot.left != null ? PRODUCT_W * slot.left : (PRODUCT_W - size.w) / 2;
                return (
                  <View
                    key={slot.id}
                    ref={(r) => (slotRefs.current[slot.id] = r)}
                    style={[
                      styles.slot,
                      {
                        top: PRODUCT_H * slot.top,
                        left,
                        width: size.w,
                        height: size.h,
                        borderRadius: slot.kind === 'stamp' ? size.h / 2 : 8,
                      },
                      isHover && styles.slotHover,
                      filled && styles.slotFilled,
                      isFlash && styles.slotWrong,
                    ]}
                  >
                    {filled ? (
                      <PlacedSticker sticker={filled} />
                    ) : (
                      <Text style={styles.slotHint}>{slot.hint}</Text>
                    )}
                  </View>
                );
              })}
            </View>
          </View>

          {/* Tray */}
          <View style={styles.tray}>
            <Text style={styles.trayTitle}>גררו כל רכיב למקומו על הבקבוק</Text>
            <View style={styles.trayRow}>
              {tray.map((sticker) => (
                <DraggableSticker
                  key={sticker.id}
                  sticker={sticker}
                  onDrop={handleDrop}
                  onDragStart={handleDragStart}
                  onDragMove={handleDragMove}
                  disabled={done}
                />
              ))}
            </View>
          </View>
        </SafeAreaView>

        {/* Completion overlay */}
        {done && (
          <View style={styles.winOverlay}>
            <View style={styles.winCard}>
              <Text style={styles.winKicker}>קטשופ</Text>
              <Text style={styles.winTitle}>התווית הושלמה</Text>
              <Text style={styles.winStars}>
                <Text style={{ color: C.gold }}>{'★'.repeat(stars)}</Text>
                <Text style={{ color: 'rgba(217,164,65,0.25)' }}>{'★'.repeat(3 - stars)}</Text>
              </Text>
              <View style={styles.statsRow}>
                <View style={styles.stat}>
                  <Text style={styles.statValue}>{formatTime(seconds)}</Text>
                  <Text style={styles.statLabel}>זמן</Text>
                </View>
                <View style={styles.statDivider} />
                <View style={styles.stat}>
                  <Text style={styles.statValue}>{mistakes}</Text>
                  <Text style={styles.statLabel}>טעויות</Text>
                </View>
                <View style={styles.statDivider} />
                <View style={styles.stat}>
                  <Text style={styles.statValue}>{accuracy}%</Text>
                  <Text style={styles.statLabel}>דיוק</Text>
                </View>
              </View>
              <TouchableOpacity style={styles.primaryButton} onPress={restart}>
                <Text style={styles.primaryButtonText}>משחק חדש</Text>
              </TouchableOpacity>
              {onBack && (
                <TouchableOpacity style={styles.ghostButton} onPress={onBack}>
                  <Text style={styles.ghostButtonText}>חזרה לתפריט</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        )}
      </LinearGradient>
    </View>
  );
}

// ---------- Label piece styles ----------

const pieces = StyleSheet.create({
  neck: {
    width: SLOT_SIZES.neck.w,
    height: SLOT_SIZES.neck.h,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  neckText: {
    fontFamily: FONT,
    color: C.paper,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
  },
  label: {
    width: SLOT_SIZES.label.w,
    height: SLOT_SIZES.label.h,
    backgroundColor: C.paper,
    borderRadius: 10,
    borderWidth: 2.5,
    borderColor: C.red,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
  },
  labelRule: {
    width: '55%',
    height: 1.5,
    backgroundColor: C.red,
    opacity: 0.55,
  },
  labelTitle: {
    fontFamily: FONT,
    fontSize: 27,
    fontWeight: '900',
    color: C.red,
    marginVertical: 2,
  },
  labelSub: {
    fontFamily: FONT,
    fontSize: 10,
    fontWeight: '500',
    color: '#5A544C',
    marginBottom: 4,
  },
  pill: {
    width: SLOT_SIZES.weight.w,
    height: SLOT_SIZES.weight.h,
    backgroundColor: C.paper,
    borderRadius: SLOT_SIZES.weight.h / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillText: {
    fontFamily: FONT,
    fontSize: 14,
    fontWeight: '700',
    color: C.ink,
  },
  stamp: {
    width: SLOT_SIZES.stamp.w,
    height: SLOT_SIZES.stamp.h,
    borderRadius: SLOT_SIZES.stamp.w / 2,
    backgroundColor: C.paper,
    borderWidth: 2,
    borderColor: C.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stampText: {
    fontFamily: FONT,
    fontSize: 13,
    fontWeight: '900',
    color: C.ink,
  },
  stampSub: {
    fontFamily: FONT,
    fontSize: 6.5,
    fontWeight: '500',
    color: C.ink,
    marginTop: -1,
  },
  barcode: {
    width: SLOT_SIZES.barcode.w,
    height: SLOT_SIZES.barcode.h,
    backgroundColor: C.paper,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  barcodeRow: {
    flexDirection: 'row',
    height: 20,
  },
  barcodeText: {
    fontFamily: FONT,
    fontSize: 6,
    color: '#191713',
    marginTop: 2,
    letterSpacing: 0.5,
  },
});

// ---------- Screen styles ----------

const styles = StyleSheet.create({
  container: {
    flex: 1,
    ...(Platform.OS === 'web' ? { userSelect: 'none' } : null),
  },
  background: { flex: 1 },
  safeArea: { flex: 1 },
  hud: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingTop: 14,
  },
  backButton: {
    width: 64,
    paddingVertical: 6,
  },
  backText: {
    fontFamily: FONT,
    color: C.muted,
    fontSize: 14,
    fontWeight: '500',
  },
  hudCenter: { alignItems: 'center', flex: 1 },
  kicker: {
    fontFamily: FONT,
    color: C.faint,
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 3,
  },
  productName: {
    fontFamily: FONT,
    color: C.text,
    fontSize: 24,
    fontWeight: '900',
    marginTop: 1,
  },
  hudRight: {
    width: 64,
    alignItems: 'flex-end',
  },
  timer: {
    fontFamily: FONT,
    color: C.text,
    fontSize: 16,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  progress: {
    fontFamily: FONT,
    color: C.muted,
    fontSize: 12,
    fontWeight: '500',
    marginTop: 2,
    fontVariant: ['tabular-nums'],
  },
  productArea: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  slot: {
    position: 'absolute',
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: 'rgba(255,255,255,0.45)',
    backgroundColor: 'rgba(0,0,0,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  slotHover: {
    borderColor: C.gold,
    backgroundColor: 'rgba(217,164,65,0.14)',
  },
  slotFilled: {
    borderWidth: 0,
    backgroundColor: 'transparent',
  },
  slotWrong: {
    borderColor: C.redBright,
    backgroundColor: 'rgba(216,64,47,0.2)',
  },
  slotHint: {
    fontFamily: FONT,
    color: 'rgba(255,255,255,0.6)',
    fontSize: 11,
    fontWeight: '500',
  },
  tray: {
    backgroundColor: C.surface,
    borderTopWidth: 1,
    borderColor: C.surfaceBorder,
    paddingTop: 12,
    paddingBottom: 20,
    paddingHorizontal: 12,
  },
  trayTitle: {
    fontFamily: FONT,
    color: C.muted,
    fontSize: 13,
    fontWeight: '500',
    textAlign: 'center',
    marginBottom: 10,
  },
  trayRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    alignItems: 'center',
  },
  stickerWrap: {
    margin: 5,
    zIndex: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.35,
    shadowRadius: 6,
    elevation: 5,
    ...(Platform.OS === 'web'
      ? { userSelect: 'none', touchAction: 'none', cursor: 'grab' }
      : null),
  },
  stickerDragging: {
    zIndex: 100,
    elevation: 12,
  },
  winOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(10,8,10,0.72)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  winCard: {
    backgroundColor: '#241F25',
    borderWidth: 1,
    borderColor: C.surfaceBorder,
    borderRadius: 20,
    paddingVertical: 30,
    paddingHorizontal: 36,
    alignItems: 'center',
    width: Math.min(width - 48, 360),
  },
  winKicker: {
    fontFamily: FONT,
    color: C.faint,
    fontSize: 12,
    fontWeight: '500',
    letterSpacing: 3,
  },
  winTitle: {
    fontFamily: FONT,
    color: C.text,
    fontSize: 26,
    fontWeight: '900',
    marginTop: 4,
  },
  winStars: {
    fontSize: 26,
    marginTop: 12,
    letterSpacing: 6,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 18,
    alignSelf: 'stretch',
    justifyContent: 'space-evenly',
  },
  stat: { alignItems: 'center', minWidth: 64 },
  statValue: {
    fontFamily: FONT,
    color: C.text,
    fontSize: 20,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  statLabel: {
    fontFamily: FONT,
    color: C.muted,
    fontSize: 12,
    fontWeight: '500',
    marginTop: 2,
  },
  statDivider: {
    width: 1,
    height: 28,
    backgroundColor: C.surfaceBorder,
  },
  primaryButton: {
    marginTop: 24,
    backgroundColor: C.red,
    borderRadius: 12,
    paddingVertical: 13,
    alignSelf: 'stretch',
    alignItems: 'center',
  },
  primaryButtonText: {
    fontFamily: FONT,
    color: C.paper,
    fontSize: 16,
    fontWeight: '700',
  },
  ghostButton: {
    marginTop: 10,
    paddingVertical: 10,
    alignSelf: 'stretch',
    alignItems: 'center',
  },
  ghostButtonText: {
    fontFamily: FONT,
    color: C.muted,
    fontSize: 14,
    fontWeight: '500',
  },
});
