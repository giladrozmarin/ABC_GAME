import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  StatusBar,
  Animated,
  Dimensions,
  PanResponder,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';

const { width } = Dimensions.get('window');

const words = [
  { word: 'CAT', emoji: '🐱', hint: 'A furry pet that meows' },
  { word: 'DOG', emoji: '🐶', hint: 'A loyal pet that barks' },
  { word: 'SUN', emoji: '☀️', hint: 'A bright star in the sky' },
  { word: 'BAT', emoji: '🦇', hint: 'A flying mammal' },
  { word: 'BEE', emoji: '🐝', hint: 'Makes honey and buzzes' },
  { word: 'EGG', emoji: '🥚', hint: 'Chickens lay these' },
  { word: 'HAT', emoji: '👒', hint: 'You wear this on your head' },
  { word: 'BOX', emoji: '📦', hint: 'You can put things inside this' },
  { word: 'ICE', emoji: '🧊', hint: 'Frozen water' },
  { word: 'PIE', emoji: '🥧', hint: 'A sweet dessert' },
];

export default function WordBuilding({ onBack }) {
  const [currentWordIndex, setCurrentWordIndex] = useState(0);
  const [userWord, setUserWord] = useState([]);
  const [availableLetters, setAvailableLetters] = useState([]);
  const [isComplete, setIsComplete] = useState(false);
  const [animatedValues, setAnimatedValues] = useState({});
  const [successAnimation] = useState(new Animated.Value(0));

  const currentWordData = words[currentWordIndex];
  const targetWord = currentWordData.word;

  useEffect(() => {
    initializeLevel();
  }, [currentWordIndex]);

  const initializeLevel = () => {
    const letters = targetWord.split('');
    // Add some extra random letters to make it more challenging
    const extraLetters = ['A', 'E', 'I', 'O', 'U', 'R', 'S', 'T', 'N', 'L']
      .filter(letter => !letters.includes(letter))
      .slice(0, 3);
    
    const allLetters = [...letters, ...extraLetters].sort(() => Math.random() - 0.5);
    
    setAvailableLetters(allLetters);
    setUserWord([]);
    setIsComplete(false);
    
    // Initialize animated values for each letter
    const newAnimatedValues = {};
    allLetters.forEach((letter, index) => {
      newAnimatedValues[`available_${index}`] = new Animated.Value(1);
    });
    letters.forEach((letter, index) => {
      newAnimatedValues[`target_${index}`] = new Animated.Value(0);
    });
    setAnimatedValues(newAnimatedValues);
    
    // Animate letters in
    allLetters.forEach((letter, index) => {
      Animated.timing(newAnimatedValues[`available_${index}`], {
        toValue: 1,
        duration: 600,
        delay: index * 100,
        useNativeDriver: true,
      }).start();
    });
  };

  const handleLetterPress = (letter, index) => {
    if (userWord.length >= targetWord.length) return;
    
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    
    // Animate letter removal from available
    Animated.timing(animatedValues[`available_${index}`], {
      toValue: 0,
      duration: 300,
      useNativeDriver: true,
    }).start();
    
    // Add to user word
    const newUserWord = [...userWord, { letter, originalIndex: index }];
    setUserWord(newUserWord);
    
    // Animate letter into target position
    const targetIndex = newUserWord.length - 1;
    setTimeout(() => {
      Animated.timing(animatedValues[`target_${targetIndex}`], {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }).start();
    }, 300);
    
    // Check if word is complete
    if (newUserWord.length === targetWord.length) {
      checkWord(newUserWord);
    }
  };

  const checkWord = (word) => {
    const userWordString = word.map(item => item.letter).join('');
    if (userWordString === targetWord) {
      setIsComplete(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      
      // Success animation
      Animated.sequence([
        Animated.timing(successAnimation, {
          toValue: 1,
          duration: 500,
          useNativeDriver: true,
        }),
        Animated.timing(successAnimation, {
          toValue: 0,
          duration: 500,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      // Wrong word - shake animation
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setTimeout(() => {
        resetUserWord();
      }, 1000);
    }
  };

  const resetUserWord = () => {
    // Animate letters back
    userWord.forEach((item, index) => {
      Animated.timing(animatedValues[`target_${index}`], {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }).start();
      
      setTimeout(() => {
        Animated.timing(animatedValues[`available_${item.originalIndex}`], {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }).start();
      }, 300);
    });
    
    setTimeout(() => {
      setUserWord([]);
    }, 600);
  };

  const handleNextWord = () => {
    setCurrentWordIndex((prev) => (prev + 1) % words.length);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  };

  const handlePreviousWord = () => {
    setCurrentWordIndex((prev) => (prev - 1 + words.length) % words.length);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  };

  const renderAvailableLetter = (letter, index) => {
    const animatedStyle = {
      opacity: animatedValues[`available_${index}`] || new Animated.Value(0),
      transform: [
        {
          scale: (animatedValues[`available_${index}`] || new Animated.Value(0)).interpolate({
            inputRange: [0, 1],
            outputRange: [0.5, 1],
          }),
        },
      ],
    };

    return (
      <Animated.View key={`${letter}-${index}`} style={[styles.letterContainer, animatedStyle]}>
        <TouchableOpacity
          style={styles.availableLetter}
          onPress={() => handleLetterPress(letter, index)}
          activeOpacity={0.7}
        >
          <LinearGradient
            colors={['#4facfe', '#00f2fe']}
            style={styles.letterGradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
          >
            <Text style={styles.letterText}>{letter}</Text>
          </LinearGradient>
        </TouchableOpacity>
      </Animated.View>
    );
  };

  const renderTargetSlot = (index) => {
    const letter = userWord[index]?.letter || '';
    const animatedStyle = {
      opacity: animatedValues[`target_${index}`] || new Animated.Value(0),
      transform: [
        {
          scale: (animatedValues[`target_${index}`] || new Animated.Value(0)).interpolate({
            inputRange: [0, 1],
            outputRange: [0.5, 1],
          }),
        },
      ],
    };

    return (
      <View key={index} style={styles.targetSlot}>
        {letter ? (
          <Animated.View style={[styles.targetLetter, animatedStyle]}>
            <LinearGradient
              colors={isComplete ? ['#43e97b', '#38f9d7'] : ['#4facfe', '#00f2fe']}
              style={styles.letterGradient}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
            >
              <Text style={styles.letterText}>{letter}</Text>
            </LinearGradient>
          </Animated.View>
        ) : (
          <View style={styles.emptySlot}>
            <Text style={styles.slotNumber}>{index + 1}</Text>
          </View>
        )}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" />
      <LinearGradient
        colors={['#4facfe', '#00f2fe']}
        style={styles.background}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      >
        <View style={styles.header}>
          <TouchableOpacity style={styles.backButton} onPress={onBack}>
            <Text style={styles.backButtonText}>← Back</Text>
          </TouchableOpacity>
          <Text style={styles.title}>Build the Word!</Text>
        </View>

        <View style={styles.wordSection}>
          <View style={styles.wordInfo}>
            <Text style={styles.emoji}>{currentWordData.emoji}</Text>
            <Text style={styles.hint}>{currentWordData.hint}</Text>
          </View>

          <View style={styles.targetWord}>
            {targetWord.split('').map((letter, index) => renderTargetSlot(index))}
          </View>
        </View>

        {isComplete && (
          <Animated.View
            style={[
              styles.successContainer,
              {
                opacity: successAnimation,
                transform: [
                  {
                    scale: successAnimation.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0.5, 1],
                    }),
                  },
                ],
              },
            ]}
          >
            <Text style={styles.successText}>🎉 Perfect! 🎉</Text>
            <Text style={styles.successSubtext}>You spelled "{targetWord}"!</Text>
          </Animated.View>
        )}

        <View style={styles.lettersSection}>
          <Text style={styles.instructionText}>Tap the letters to build the word:</Text>
          <View style={styles.availableLetters}>
            {availableLetters.map((letter, index) => renderAvailableLetter(letter, index))}
          </View>
        </View>

        <View style={styles.controls}>
          <TouchableOpacity style={styles.controlButton} onPress={handlePreviousWord}>
            <Text style={styles.controlButtonText}>← Previous</Text>
          </TouchableOpacity>
          
          <TouchableOpacity style={styles.resetButton} onPress={resetUserWord}>
            <Text style={styles.resetButtonText}>Reset</Text>
          </TouchableOpacity>
          
          <TouchableOpacity style={styles.controlButton} onPress={handleNextWord}>
            <Text style={styles.controlButtonText}>Next →</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.progress}>
          <Text style={styles.progressText}>
            Word {currentWordIndex + 1} of {words.length}
          </Text>
        </View>
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
  wordSection: {
    alignItems: 'center',
    marginBottom: 30,
  },
  wordInfo: {
    alignItems: 'center',
    marginBottom: 20,
  },
  emoji: {
    fontSize: 60,
    marginBottom: 10,
  },
  hint: {
    color: 'white',
    fontSize: 18,
    textAlign: 'center',
    fontStyle: 'italic',
    marginBottom: 20,
  },
  targetWord: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 10,
  },
  targetSlot: {
    width: 60,
    height: 60,
    justifyContent: 'center',
    alignItems: 'center',
  },
  targetLetter: {
    width: 60,
    height: 60,
    borderRadius: 15,
    overflow: 'hidden',
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
  emptySlot: {
    width: 60,
    height: 60,
    borderRadius: 15,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.4)',
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
  },
  slotNumber: {
    color: 'rgba(255, 255, 255, 0.6)',
    fontSize: 14,
    fontWeight: 'bold',
  },
  successContainer: {
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    marginHorizontal: 20,
    padding: 20,
    borderRadius: 20,
    alignItems: 'center',
    marginBottom: 20,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  successText: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#00f2fe',
    marginBottom: 5,
  },
  successSubtext: {
    fontSize: 16,
    color: '#4facfe',
  },
  lettersSection: {
    flex: 1,
    paddingHorizontal: 20,
  },
  instructionText: {
    color: 'white',
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 20,
  },
  availableLetters: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 10,
  },
  letterContainer: {
    marginBottom: 10,
  },
  availableLetter: {
    width: 50,
    height: 50,
    borderRadius: 12,
    overflow: 'hidden',
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
  },
  letterGradient: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  letterText: {
    fontSize: 24,
    fontWeight: 'bold',
    color: 'white',
    textShadowColor: 'rgba(0,0,0,0.3)',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 2,
  },
  controls: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    marginBottom: 10,
  },
  controlButton: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 25,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.3)',
  },
  controlButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  resetButton: {
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    paddingHorizontal: 25,
    paddingVertical: 12,
    borderRadius: 25,
  },
  resetButtonText: {
    color: '#00f2fe',
    fontSize: 16,
    fontWeight: 'bold',
  },
  progress: {
    alignItems: 'center',
    paddingBottom: 20,
  },
  progressText: {
    color: 'rgba(255, 255, 255, 0.8)',
    fontSize: 14,
  },
}); 