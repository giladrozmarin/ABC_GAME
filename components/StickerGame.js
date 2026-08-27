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
import Svg, { Rect, Path, Ellipse } from 'react-native-svg';

const { width, height } = Dimensions.get('window');

const PRODUCT_H = Math.min(height * 0.42, 400);
const PRODUCT_W = PRODUCT_H * 0.52;

// ---------- Product illustrations ----------

function KetchupBottle() {
  return (
    <Svg width={PRODUCT_W} height={PRODUCT_H} viewBox="0 0 100 190">
      {/* Cap */}
      <Rect x="36" y="2" width="28" height="14" rx="3" fill="#B71C1C" />
      <Rect x="38" y="16" width="24" height="6" fill="#D32F2F" />
      {/* Neck */}
      <Path d="M40 22 L60 22 L66 44 L34 44 Z" fill="#E53935" />
      {/* Body */}
      <Path
        d="M34 44 C18 52 14 62 14 78 L14 168 C14 178 22 186 32 186 L68 186 C78 186 86 178 86 168 L86 78 C86 62 82 52 66 44 Z"
        fill="#E53935"
        stroke="#C62828"
        strokeWidth="2"
      />
      {/* Highlight */}
      <Ellipse cx="26" cy="100" rx="6" ry="34" fill="#EF5350" opacity="0.7" />
    </Svg>
  );
}

function ChocoMilkCarton() {
  return (
    <Svg width={PRODUCT_W} height={PRODUCT_H} viewBox="0 0 100 190">
      {/* Cap on the gable */}
      <Rect x="43" y="6" width="14" height="12" rx="3" fill="#4E342E" />
      {/* Gable top */}
      <Path d="M18 46 L50 16 L82 46 Z" fill="#8D6E63" stroke="#5D4037" strokeWidth="2" />
      {/* Body */}
      <Rect
        x="16"
        y="44"
        width="68"
        height="140"
        rx="7"
        fill="#795548"
        stroke="#5D4037"
        strokeWidth="2"
      />
      {/* Highlight */}
      <Ellipse cx="28" cy="110" rx="5" ry="40" fill="#A1887F" opacity="0.6" />
    </Svg>
  );
}

function SnackBag() {
  return (
    <Svg width={PRODUCT_W} height={PRODUCT_H} viewBox="0 0 100 190">
      {/* Top crimp */}
      <Rect x="8" y="14" width="84" height="12" rx="4" fill="#FB8C00" />
      {/* Body */}
      <Rect
        x="12"
        y="24"
        width="76"
        height="142"
        rx="12"
        fill="#FFA726"
        stroke="#EF6C00"
        strokeWidth="2"
      />
      {/* Bottom crimp */}
      <Rect x="8" y="164" width="84" height="12" rx="4" fill="#FB8C00" />
      {/* Highlight */}
      <Ellipse cx="26" cy="90" rx="6" ry="36" fill="#FFCC80" opacity="0.7" />
    </Svg>
  );
}

// ---------- Levels (data-driven: add a product = add an entry) ----------

const LEVELS = [
  {
    id: 'ketchup',
    name: 'קטשופ',
    emoji: '🍅',
    colors: ['#FF8A65', '#E53935'],
    accent: '#C62828',
    Product: KetchupBottle,
    slots: [
      { id: 'pic', label: 'תמונה', top: 0.24, w: 0.42, h: 0.16, shape: 'circle' },
      { id: 'name', label: 'שם המוצר', top: 0.44, w: 0.78, h: 0.13, shape: 'pill' },
      { id: 'weight', label: 'משקל', top: 0.61, w: 0.6, h: 0.1, shape: 'pill' },
      { id: 'origin', label: 'תוצרת', top: 0.75, w: 0.7, h: 0.09, shape: 'pill' },
    ],
    stickers: [
      { id: 's-pic', type: 'emoji', content: '🍅', slot: 'pic' },
      { id: 's-name', type: 'text', content: 'קטשופ', slot: 'name' },
      { id: 's-weight', type: 'text', content: '750 גרם', slot: 'weight' },
      { id: 's-origin', type: 'text', content: 'תוצרת ישראל', slot: 'origin' },
      { id: 'd-1', type: 'text', content: 'חרדל', slot: null },
      { id: 'd-2', type: 'emoji', content: '🥒', slot: null },
      { id: 'd-3', type: 'text', content: '1 ליטר', slot: null },
    ],
  },
  {
    id: 'choco',
    name: 'שוקו',
    emoji: '🍫',
    colors: ['#A1887F', '#5D4037'],
    accent: '#4E342E',
    Product: ChocoMilkCarton,
    slots: [
      { id: 'pic', label: 'תמונה', top: 0.31, w: 0.4, h: 0.15, shape: 'circle' },
      { id: 'name', label: 'שם המוצר', top: 0.5, w: 0.56, h: 0.12, shape: 'pill' },
      { id: 'volume', label: 'נפח', top: 0.65, w: 0.5, h: 0.1, shape: 'pill' },
      { id: 'kind', label: 'סוג', top: 0.78, w: 0.56, h: 0.09, shape: 'pill' },
    ],
    stickers: [
      { id: 's-pic', type: 'emoji', content: '🍫', slot: 'pic' },
      { id: 's-name', type: 'text', content: 'שוקו', slot: 'name' },
      { id: 's-volume', type: 'text', content: '1 ליטר', slot: 'volume' },
      { id: 's-kind', type: 'text', content: 'מוצר חלב', slot: 'kind' },
      { id: 'd-1', type: 'text', content: 'קפה', slot: null },
      { id: 'd-2', type: 'emoji', content: '🍅', slot: null },
      { id: 'd-3', type: 'text', content: '750 גרם', slot: null },
    ],
  },
  {
    id: 'bamba',
    name: 'במבה',
    emoji: '🥜',
    colors: ['#FFB74D', '#F57C00'],
    accent: '#E65100',
    Product: SnackBag,
    slots: [
      { id: 'pic', label: 'תמונה', top: 0.22, w: 0.45, h: 0.17, shape: 'circle' },
      { id: 'name', label: 'שם המוצר', top: 0.43, w: 0.62, h: 0.13, shape: 'pill' },
      { id: 'weight', label: 'משקל', top: 0.6, w: 0.55, h: 0.1, shape: 'pill' },
      { id: 'kind', label: 'סוג', top: 0.74, w: 0.6, h: 0.09, shape: 'pill' },
    ],
    stickers: [
      { id: 's-pic', type: 'emoji', content: '🥜', slot: 'pic' },
      { id: 's-name', type: 'text', content: 'במבה', slot: 'name' },
      { id: 's-weight', type: 'text', content: '80 גרם', slot: 'weight' },
      { id: 's-kind', type: 'text', content: 'חטיף אפוי', slot: 'kind' },
      { id: 'd-1', type: 'text', content: 'שוקולד', slot: null },
      { id: 'd-2', type: 'emoji', content: '🧀', slot: null },
      { id: 'd-3', type: 'text', content: '1 ק"ג', slot: null },
    ],
  },
];

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Forgiving hit margin around slots so kids don't need pixel precision
const HIT_MARGIN = 14;

function hitTest(rects, x, y) {
  return rects.find(
    (r) =>
      x >= r.x - HIT_MARGIN &&
      x <= r.x + r.w + HIT_MARGIN &&
      y >= r.y - HIT_MARGIN &&
      y <= r.y + r.h + HIT_MARGIN
  );
}

// ---------- Draggable sticker in the tray ----------

function DraggableSticker({ sticker, onDrop, onDragStart, onDragMove, disabled, accent }) {
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
      Animated.timing(shakeX, { toValue: 8, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeX, { toValue: -8, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeX, { toValue: 5, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeX, { toValue: 0, duration: 50, useNativeDriver: true }),
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
        Animated.spring(scale, { toValue: 1.15, useNativeDriver: true }).start();
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
      {sticker.type === 'emoji' ? (
        <View style={styles.emojiSticker}>
          <Text style={styles.emojiText}>{sticker.content}</Text>
        </View>
      ) : (
        <View style={styles.textSticker}>
          <Text style={[styles.textStickerLabel, { color: accent }]}>{sticker.content}</Text>
        </View>
      )}
    </Animated.View>
  );
}

// Content rendered inside a filled slot
function PlacedSticker({ sticker, accent }) {
  const pop = useRef(new Animated.Value(0.3)).current;
  useEffect(() => {
    Animated.spring(pop, { toValue: 1, friction: 4, useNativeDriver: true }).start();
  }, [pop]);
  return (
    <Animated.View style={{ transform: [{ scale: pop }] }}>
      {sticker.type === 'emoji' ? (
        <Text style={styles.placedEmoji}>{sticker.content}</Text>
      ) : (
        <Text style={[styles.placedText, { color: accent }]}>{sticker.content}</Text>
      )}
    </Animated.View>
  );
}

// Falling confetti piece for the win screen
function ConfettiPiece({ delay, startX, emoji }) {
  const fall = useRef(new Animated.Value(-60)).current;
  const spin = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.parallel([
      Animated.timing(fall, {
        toValue: height + 60,
        duration: 2600 + Math.random() * 1500,
        delay,
        useNativeDriver: true,
      }),
      Animated.loop(
        Animated.timing(spin, { toValue: 1, duration: 900, useNativeDriver: true })
      ),
    ]).start();
  }, [fall, spin, delay]);
  return (
    <Animated.Text
      style={{
        position: 'absolute',
        left: startX,
        fontSize: 26,
        transform: [
          { translateY: fall },
          {
            rotate: spin.interpolate({
              inputRange: [0, 1],
              outputRange: ['0deg', '360deg'],
            }),
          },
        ],
      }}
    >
      {emoji}
    </Animated.Text>
  );
}

// ---------- Main game ----------

export default function StickerGame({ onBack }) {
  const [levelIndex, setLevelIndex] = useState(0);
  const level = LEVELS[levelIndex];

  const [tray, setTray] = useState(() => shuffle(LEVELS[0].stickers));
  const [placed, setPlaced] = useState({}); // slotId -> sticker
  const placedRef = useRef({}); // latest placed map, readable from drop handler
  const [mistakes, setMistakes] = useState(0);
  const [flashSlot, setFlashSlot] = useState(null);
  const [hoverSlot, setHoverSlot] = useState(null);
  const [done, setDone] = useState(false);
  const [earnedStars, setEarnedStars] = useState([]); // stars per completed level
  const slotRefs = useRef({});
  const dragRects = useRef([]); // cached open-slot rects during a drag

  const filledCount = Object.keys(placed).length;
  const stars = mistakes <= 1 ? 3 : mistakes <= 3 ? 2 : 1;
  const isLastLevel = levelIndex === LEVELS.length - 1;

  const measureSlot = (id) =>
    new Promise((resolve) => {
      const ref = slotRefs.current[id];
      if (!ref) return resolve(null);
      ref.measureInWindow((x, y, w, h) => resolve({ id, x, y, w, h }));
    });

  const measureOpenSlots = useCallback(async () => {
    const open = LEVELS[levelIndexRef.current].slots.filter(
      (s) => !placedRef.current[s.id]
    );
    return (await Promise.all(open.map((s) => measureSlot(s.id)))).filter(Boolean);
  }, []);

  // level index readable from stable callbacks
  const levelIndexRef = useRef(0);
  levelIndexRef.current = levelIndex;

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
        if (
          Object.keys(nextPlaced).length === LEVELS[levelIndexRef.current].slots.length
        ) {
          setTimeout(() => setDone(true), 600);
        }
        return 'placed';
      }

      if (Platform.OS !== 'web') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
      setMistakes((m) => m + 1);
      setFlashSlot(hit.id);
      setTimeout(() => setFlashSlot(null), 500);
      return 'wrong';
    },
    [measureOpenSlots]
  );

  const startLevel = (index) => {
    slotRefs.current = {};
    placedRef.current = {};
    setLevelIndex(index);
    setTray(shuffle(LEVELS[index].stickers));
    setPlaced({});
    setMistakes(0);
    setHoverSlot(null);
    setDone(false);
  };

  const nextLevel = () => {
    setEarnedStars((e) => [...e, stars]);
    startLevel(levelIndex + 1);
  };

  const restartAll = () => {
    setEarnedStars([]);
    startLevel(0);
  };

  const totalStars = earnedStars.reduce((a, b) => a + b, 0) + (done ? stars : 0);
  const ProductArt = level.Product;

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />
      <LinearGradient
        colors={level.colors}
        style={styles.background}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      >
        <SafeAreaView style={styles.safeArea}>
          <View style={styles.header}>
            {onBack ? (
              <TouchableOpacity style={styles.backButton} onPress={onBack}>
                <Text style={styles.backText}>→ חזרה</Text>
              </TouchableOpacity>
            ) : (
              <View style={styles.backButton} />
            )}
            <View style={styles.headerCenter}>
              <Text style={styles.title}>🏷️ משחק המדבקות</Text>
              <Text style={styles.subtitle}>השלימו את המדבקות על ה{level.name}!</Text>
            </View>
            <View style={styles.progressBadge}>
              <Text style={styles.progressText}>
                {filledCount}/{level.slots.length}
              </Text>
            </View>
          </View>

          {/* Level dots */}
          <View style={styles.levelDots}>
            {LEVELS.map((l, i) => (
              <Text
                key={l.id}
                style={[styles.levelDot, i === levelIndex && styles.levelDotActive]}
              >
                {i < levelIndex || (i === levelIndex && done) ? l.emoji : '•'}
              </Text>
            ))}
          </View>

          {/* Product area */}
          <View style={styles.productArea}>
            <View key={level.id} style={{ width: PRODUCT_W, height: PRODUCT_H }}>
              <ProductArt />
              {level.slots.map((slot) => {
                const filled = placed[slot.id];
                const isFlash = flashSlot === slot.id;
                const isHover = hoverSlot === slot.id && !filled;
                const slotW = PRODUCT_W * slot.w;
                const slotH = PRODUCT_H * slot.h;
                return (
                  <View
                    key={slot.id}
                    ref={(r) => (slotRefs.current[slot.id] = r)}
                    style={[
                      styles.slot,
                      {
                        top: PRODUCT_H * slot.top,
                        left: (PRODUCT_W - slotW) / 2,
                        width: slotW,
                        height: slotH,
                        borderRadius: slot.shape === 'circle' ? slotH / 2 : 12,
                      },
                      isHover && styles.slotHover,
                      filled && styles.slotFilled,
                      isFlash && styles.slotWrong,
                    ]}
                  >
                    {filled ? (
                      <PlacedSticker sticker={filled} accent={level.accent} />
                    ) : (
                      <Text style={styles.slotHint}>{slot.label}</Text>
                    )}
                  </View>
                );
              })}
            </View>
          </View>

          {/* Sticker tray */}
          <View style={styles.tray}>
            <Text style={styles.trayTitle}>גררו מדבקה למקום הנכון 👇</Text>
            <View style={styles.trayRow}>
              {tray.map((sticker) => (
                <DraggableSticker
                  key={`${level.id}-${sticker.id}`}
                  sticker={sticker}
                  onDrop={handleDrop}
                  onDragStart={handleDragStart}
                  onDragMove={handleDragMove}
                  disabled={done}
                  accent={level.accent}
                />
              ))}
            </View>
          </View>
        </SafeAreaView>

        {/* Win overlay */}
        {done && (
          <View style={styles.winOverlay}>
            {Array.from({ length: 18 }).map((_, i) => (
              <ConfettiPiece
                key={`${level.id}-${i}`}
                delay={i * 120}
                startX={(width / 18) * i}
                emoji={['🎉', '⭐', level.emoji, '✨'][i % 4]}
              />
            ))}
            <View style={styles.winCard}>
              <Text style={styles.winEmoji}>{isLastLevel ? '🏆' : '🎉'}</Text>
              <Text style={[styles.winTitle, { color: level.accent }]}>
                {isLastLevel ? 'אלופים!' : 'כל הכבוד!'}
              </Text>
              <Text style={styles.winSub}>
                {isLastLevel
                  ? `סיימתם את כל המוצרים עם ${totalStars} כוכבים!`
                  : `השלמתם את כל המדבקות על ה${level.name}!`}
              </Text>
              <Text style={styles.winStars}>
                {'⭐'.repeat(stars)}
                {'☆'.repeat(3 - stars)}
              </Text>
              {isLastLevel ? (
                <TouchableOpacity
                  style={[styles.winButton, { backgroundColor: level.accent }]}
                  onPress={restartAll}
                >
                  <Text style={styles.winButtonText}>שחקו שוב מההתחלה 🔄</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={[styles.winButton, { backgroundColor: level.accent }]}
                  onPress={nextLevel}
                >
                  <Text style={styles.winButtonText}>
                    למוצר הבא {LEVELS[levelIndex + 1].emoji}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        )}
      </LinearGradient>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    ...(Platform.OS === 'web' ? { userSelect: 'none' } : null),
  },
  background: { flex: 1 },
  safeArea: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  backButton: { width: 70 },
  backText: { color: 'white', fontSize: 16, fontWeight: 'bold' },
  headerCenter: { alignItems: 'center', flex: 1 },
  title: { fontSize: 24, fontWeight: 'bold', color: 'white' },
  subtitle: { fontSize: 14, color: 'rgba(255,255,255,0.9)', marginTop: 2 },
  progressBadge: {
    width: 70,
    alignItems: 'flex-end',
  },
  progressText: {
    backgroundColor: 'rgba(255,255,255,0.25)',
    color: 'white',
    fontWeight: 'bold',
    fontSize: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    overflow: 'hidden',
  },
  levelDots: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 6,
  },
  levelDot: {
    fontSize: 18,
    color: 'rgba(255,255,255,0.6)',
    marginHorizontal: 6,
  },
  levelDotActive: {
    color: 'white',
    fontWeight: 'bold',
  },
  productArea: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  slot: {
    position: 'absolute',
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: 'rgba(255,255,255,0.9)',
    backgroundColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  slotHover: {
    borderColor: '#FFF59D',
    backgroundColor: 'rgba(255,255,255,0.55)',
    transform: [{ scale: 1.06 }],
  },
  slotFilled: {
    borderStyle: 'solid',
    borderColor: '#FFF',
    backgroundColor: 'rgba(255,255,255,0.95)',
  },
  slotWrong: {
    borderColor: '#FFEB3B',
    backgroundColor: 'rgba(255,235,59,0.4)',
  },
  slotHint: {
    color: 'rgba(255,255,255,0.95)',
    fontSize: 12,
    fontWeight: '600',
  },
  placedEmoji: { fontSize: 34 },
  placedText: { fontSize: 16, fontWeight: 'bold' },
  tray: {
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 10,
    paddingBottom: 18,
    paddingHorizontal: 10,
  },
  trayTitle: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 8,
  },
  trayRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  stickerWrap: {
    margin: 6,
    zIndex: 1,
    ...(Platform.OS === 'web'
      ? { userSelect: 'none', touchAction: 'none', cursor: 'grab' }
      : null),
  },
  stickerDragging: {
    zIndex: 100,
    elevation: 10,
  },
  emojiSticker: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: 'white',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 4,
  },
  emojiText: { fontSize: 32 },
  textSticker: {
    backgroundColor: 'white',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 4,
  },
  textStickerLabel: { fontSize: 16, fontWeight: 'bold' },
  winOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  winCard: {
    backgroundColor: 'white',
    borderRadius: 24,
    paddingVertical: 28,
    paddingHorizontal: 36,
    alignItems: 'center',
    maxWidth: width * 0.85,
  },
  winEmoji: { fontSize: 48 },
  winTitle: { fontSize: 30, fontWeight: 'bold', marginTop: 6 },
  winSub: { fontSize: 16, color: '#555', marginTop: 6, textAlign: 'center' },
  winStars: { fontSize: 30, marginTop: 10 },
  winButton: {
    marginTop: 18,
    paddingHorizontal: 28,
    paddingVertical: 12,
    borderRadius: 20,
  },
  winButtonText: { color: 'white', fontSize: 18, fontWeight: 'bold' },
});
