import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  SafeAreaView,
  StatusBar,
  Animated,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

// Import game components
import AlphabetLearning from './components/AlphabetLearning';
import LetterTracing from './components/LetterTracing';
import WordBuilding from './components/WordBuilding';
import LetterQuiz from './components/LetterQuiz';

const { width, height } = Dimensions.get('window');

const gameTypes = [
  {
    id: 'learning',
    title: 'Learn ABC',
    description: 'Interactive alphabet learning',
    icon: '📚',
    color: ['#667eea', '#764ba2'],
  },
  {
    id: 'tracing',
    title: 'Letter Tracing',
    description: 'Trace letters with your finger',
    icon: '✏️',
    color: ['#f093fb', '#f5576c'],
  },
  {
    id: 'building',
    title: 'Word Building',
    description: 'Build words with letters',
    icon: '🧩',
    color: ['#4facfe', '#00f2fe'],
  },
  {
    id: 'quiz',
    title: 'Letter Quiz',
    description: 'Test your ABC knowledge',
    icon: '🎯',
    color: ['#43e97b', '#38f9d7'],
  },
];

export default function App() {
  const [currentScreen, setCurrentScreen] = useState('home');
  const [animatedValues] = useState(
    gameTypes.map(() => new Animated.Value(0))
  );

  useEffect(() => {
    // Animate cards on load
    const animations = animatedValues.map((value, index) =>
      Animated.timing(value, {
        toValue: 1,
        duration: 800,
        delay: index * 200,
        useNativeDriver: true,
      })
    );
    Animated.stagger(100, animations).start();
  }, []);

  const handleGameSelect = (gameType) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setCurrentScreen(gameType);
  };

  const handleBackToHome = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setCurrentScreen('home');
  };

  const renderGameCard = (game, index) => {
    const animatedStyle = {
      opacity: animatedValues[index],
      transform: [
        {
          translateY: animatedValues[index].interpolate({
            inputRange: [0, 1],
            outputRange: [50, 0],
          }),
        },
      ],
    };

    return (
      <Animated.View key={game.id} style={[styles.cardContainer, animatedStyle]}>
        <TouchableOpacity
          style={styles.gameCard}
          onPress={() => handleGameSelect(game.id)}
          activeOpacity={0.8}
        >
          <LinearGradient
            colors={game.color}
            style={styles.cardGradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
          >
            <Text style={styles.gameIcon}>{game.icon}</Text>
            <Text style={styles.gameTitle}>{game.title}</Text>
            <Text style={styles.gameDescription}>{game.description}</Text>
          </LinearGradient>
        </TouchableOpacity>
      </Animated.View>
    );
  };

  if (currentScreen === 'learning') {
    return <AlphabetLearning onBack={handleBackToHome} />;
  }

  if (currentScreen === 'tracing') {
    return <LetterTracing onBack={handleBackToHome} />;
  }

  if (currentScreen === 'building') {
    return <WordBuilding onBack={handleBackToHome} />;
  }

  if (currentScreen === 'quiz') {
    return <LetterQuiz onBack={handleBackToHome} />;
  }

  return (
    <GestureHandlerRootView style={styles.container}>
      <StatusBar barStyle="light-content" />
      <LinearGradient
        colors={['#667eea', '#764ba2']}
        style={styles.background}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      >
        <SafeAreaView style={styles.safeArea}>
          <View style={styles.header}>
            <Text style={styles.appTitle}>🌟 ABC Learning Game 🌟</Text>
            <Text style={styles.subtitle}>Choose your adventure!</Text>
          </View>

          <View style={styles.gamesContainer}>
            {gameTypes.map((game, index) => renderGameCard(game, index))}
          </View>

          <View style={styles.footer}>
            <Text style={styles.footerText}>Made with ❤️ for learning</Text>
          </View>
        </SafeAreaView>
      </LinearGradient>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  background: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
    paddingHorizontal: 20,
  },
  header: {
    alignItems: 'center',
    paddingTop: 20,
    paddingBottom: 30,
  },
  appTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: 'white',
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: 'rgba(255, 255, 255, 0.8)',
    textAlign: 'center',
  },
  gamesContainer: {
    flex: 1,
    justifyContent: 'center',
  },
  cardContainer: {
    marginBottom: 20,
  },
  gameCard: {
    borderRadius: 20,
    overflow: 'hidden',
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  cardGradient: {
    padding: 25,
    alignItems: 'center',
    minHeight: 120,
    justifyContent: 'center',
  },
  gameIcon: {
    fontSize: 40,
    marginBottom: 10,
  },
  gameTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: 'white',
    textAlign: 'center',
    marginBottom: 5,
  },
  gameDescription: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.9)',
    textAlign: 'center',
  },
  footer: {
    paddingBottom: 20,
    alignItems: 'center',
  },
  footerText: {
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: 14,
  },
}); 