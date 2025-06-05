import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  StatusBar,
  Animated,
  ScrollView,
  Dimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';

const { width } = Dimensions.get('window');

const alphabet = [
  { letter: 'A', word: 'Apple', emoji: '🍎', color: ['#ff9a9e', '#fecfef'] },
  { letter: 'B', word: 'Ball', emoji: '⚽', color: ['#a18cd1', '#fbc2eb'] },
  { letter: 'C', word: 'Cat', emoji: '🐱', color: ['#fad0c4', '#ffd1ff'] },
  { letter: 'D', word: 'Dog', emoji: '🐶', color: ['#ffecd2', '#fcb69f'] },
  { letter: 'E', word: 'Elephant', emoji: '🐘', color: ['#a8edea', '#fed6e3'] },
  { letter: 'F', word: 'Fish', emoji: '🐠', color: ['#d299c2', '#fef9d7'] },
  { letter: 'G', word: 'Giraffe', emoji: '🦒', color: ['#89f7fe', '#66a6ff'] },
  { letter: 'H', word: 'Horse', emoji: '🐴', color: ['#fdbb2d', '#22c1c3'] },
  { letter: 'I', word: 'Ice Cream', emoji: '🍦', color: ['#e0c3fc', '#9bb5ff'] },
  { letter: 'J', word: 'Jellyfish', emoji: '🐙', color: ['#667eea', '#764ba2'] },
  { letter: 'K', word: 'Kite', emoji: '🪁', color: ['#f093fb', '#f5576c'] },
  { letter: 'L', word: 'Lion', emoji: '🦁', color: ['#4facfe', '#00f2fe'] },
  { letter: 'M', word: 'Mouse', emoji: '🐭', color: ['#43e97b', '#38f9d7'] },
  { letter: 'N', word: 'Nest', emoji: '🥚', color: ['#fa709a', '#fee140'] },
  { letter: 'O', word: 'Octopus', emoji: '🐙', color: ['#a8edea', '#fed6e3'] },
  { letter: 'P', word: 'Penguin', emoji: '🐧', color: ['#ffecd2', '#fcb69f'] },
  { letter: 'Q', word: 'Queen', emoji: '👑', color: ['#fad0c4', '#ffd1ff'] },
  { letter: 'R', word: 'Rainbow', emoji: '🌈', color: ['#a18cd1', '#fbc2eb'] },
  { letter: 'S', word: 'Sun', emoji: '☀️', color: ['#ff9a9e', '#fecfef'] },
  { letter: 'T', word: 'Tiger', emoji: '🐅', color: ['#667eea', '#764ba2'] },
  { letter: 'U', word: 'Umbrella', emoji: '☂️', color: ['#f093fb', '#f5576c'] },
  { letter: 'V', word: 'Violin', emoji: '🎻', color: ['#4facfe', '#00f2fe'] },
  { letter: 'W', word: 'Whale', emoji: '🐋', color: ['#43e97b', '#38f9d7'] },
  { letter: 'X', word: 'Xylophone', emoji: '🎵', color: ['#fa709a', '#fee140'] },
  { letter: 'Y', word: 'Yacht', emoji: '⛵', color: ['#a8edea', '#fed6e3'] },
  { letter: 'Z', word: 'Zebra', emoji: '🦓', color: ['#ffecd2', '#fcb69f'] },
];

export default function AlphabetLearning({ onBack }) {
  const [selectedLetter, setSelectedLetter] = useState(null);
  const [animatedValues] = useState(
    alphabet.map(() => new Animated.Value(0))
  );
  const [selectedAnimation] = useState(new Animated.Value(0));

  useEffect(() => {
    // Animate letter cards on load
    const animations = animatedValues.map((value, index) =>
      Animated.timing(value, {
        toValue: 1,
        duration: 600,
        delay: index * 50,
        useNativeDriver: true,
      })
    );
    Animated.stagger(30, animations).start();
  }, []);

  const handleLetterPress = (letterData, index) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setSelectedLetter(letterData);
    
    // Animate selected letter
    Animated.sequence([
      Animated.timing(selectedAnimation, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }),
      Animated.timing(selectedAnimation, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start();
  };

  const renderLetterCard = (letterData, index) => {
    const animatedStyle = {
      opacity: animatedValues[index],
      transform: [
        {
          scale: animatedValues[index].interpolate({
            inputRange: [0, 1],
            outputRange: [0.8, 1],
          }),
        },
      ],
    };

    return (
      <Animated.View key={letterData.letter} style={[styles.letterCard, animatedStyle]}>
        <TouchableOpacity
          onPress={() => handleLetterPress(letterData, index)}
          activeOpacity={0.8}
        >
          <LinearGradient
            colors={letterData.color}
            style={styles.cardGradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
          >
            <Text style={styles.letterText}>{letterData.letter}</Text>
            <Text style={styles.emojiText}>{letterData.emoji}</Text>
            <Text style={styles.wordText}>{letterData.word}</Text>
          </LinearGradient>
        </TouchableOpacity>
      </Animated.View>
    );
  };

  const renderSelectedLetter = () => {
    if (!selectedLetter) return null;

    const selectedAnimatedStyle = {
      opacity: selectedAnimation,
      transform: [
        {
          scale: selectedAnimation.interpolate({
            inputRange: [0, 1],
            outputRange: [0.8, 1.2],
          }),
        },
      ],
    };

    return (
      <Animated.View style={[styles.selectedContainer, selectedAnimatedStyle]}>
        <LinearGradient
          colors={selectedLetter.color}
          style={styles.selectedGradient}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
        >
          <Text style={styles.selectedLetter}>{selectedLetter.letter}</Text>
          <Text style={styles.selectedEmoji}>{selectedLetter.emoji}</Text>
          <Text style={styles.selectedWord}>{selectedLetter.word}</Text>
          <Text style={styles.pronunciationText}>
            "{selectedLetter.letter}" is for "{selectedLetter.word}"
          </Text>
        </LinearGradient>
      </Animated.View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" />
      <LinearGradient
        colors={['#667eea', '#764ba2']}
        style={styles.background}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      >
        <View style={styles.header}>
          <TouchableOpacity style={styles.backButton} onPress={onBack}>
            <Text style={styles.backButtonText}>← Back</Text>
          </TouchableOpacity>
          <Text style={styles.title}>Learn the Alphabet!</Text>
        </View>

        {selectedLetter && renderSelectedLetter()}

        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.gridContainer}>
            {alphabet.map((letterData, index) => renderLetterCard(letterData, index))}
          </View>
        </ScrollView>
      </LinearGradient>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  background: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 20,
  },
  backButton: {
    padding: 10,
  },
  backButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  title: {
    flex: 1,
    textAlign: 'center',
    fontSize: 24,
    fontWeight: 'bold',
    color: 'white',
    marginRight: 50,
  },
  selectedContainer: {
    marginHorizontal: 20,
    marginBottom: 20,
    borderRadius: 20,
    overflow: 'hidden',
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  selectedGradient: {
    padding: 30,
    alignItems: 'center',
  },
  selectedLetter: {
    fontSize: 80,
    fontWeight: 'bold',
    color: 'white',
    textShadowColor: 'rgba(0,0,0,0.3)',
    textShadowOffset: { width: 2, height: 2 },
    textShadowRadius: 4,
  },
  selectedEmoji: {
    fontSize: 60,
    marginVertical: 10,
  },
  selectedWord: {
    fontSize: 28,
    fontWeight: 'bold',
    color: 'white',
    marginBottom: 10,
  },
  pronunciationText: {
    fontSize: 16,
    color: 'rgba(255, 255, 255, 0.9)',
    textAlign: 'center',
    fontStyle: 'italic',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  gridContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  letterCard: {
    width: (width - 60) / 3,
    marginBottom: 15,
    borderRadius: 15,
    overflow: 'hidden',
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
  cardGradient: {
    padding: 15,
    alignItems: 'center',
    minHeight: 120,
    justifyContent: 'center',
  },
  letterText: {
    fontSize: 32,
    fontWeight: 'bold',
    color: 'white',
    textShadowColor: 'rgba(0,0,0,0.3)',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 2,
  },
  emojiText: {
    fontSize: 24,
    marginVertical: 5,
  },
  wordText: {
    fontSize: 12,
    color: 'white',
    textAlign: 'center',
    fontWeight: '600',
  },
}); 