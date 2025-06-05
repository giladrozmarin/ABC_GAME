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
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';

const { width } = Dimensions.get('window');

const quizData = [
  {
    question: 'Which letter comes after A?',
    options: ['B', 'C', 'Z', 'X'],
    correct: 0,
    type: 'next_letter'
  },
  {
    question: 'What letter does "Apple" start with?',
    emoji: '🍎',
    options: ['B', 'A', 'C', 'D'],
    correct: 1,
    type: 'first_letter'
  },
  {
    question: 'Which letter comes before D?',
    options: ['E', 'F', 'C', 'B'],
    correct: 2,
    type: 'previous_letter'
  },
  {
    question: 'What letter does "Cat" start with?',
    emoji: '🐱',
    options: ['A', 'B', 'C', 'D'],
    correct: 2,
    type: 'first_letter'
  },
  {
    question: 'Which letter comes after M?',
    options: ['L', 'N', 'O', 'P'],
    correct: 1,
    type: 'next_letter'
  },
  {
    question: 'What letter does "Sun" start with?',
    emoji: '☀️',
    options: ['R', 'S', 'T', 'U'],
    correct: 1,
    type: 'first_letter'
  },
  {
    question: 'Which letter comes before G?',
    options: ['H', 'E', 'F', 'I'],
    correct: 2,
    type: 'previous_letter'
  },
  {
    question: 'What letter does "Dog" start with?',
    emoji: '🐶',
    options: ['C', 'D', 'E', 'F'],
    correct: 1,
    type: 'first_letter'
  },
  {
    question: 'Which letter comes after R?',
    options: ['Q', 'S', 'T', 'U'],
    correct: 1,
    type: 'next_letter'
  },
  {
    question: 'What letter does "Elephant" start with?',
    emoji: '🐘',
    options: ['D', 'E', 'F', 'G'],
    correct: 1,
    type: 'first_letter'
  },
];

export default function LetterQuiz({ onBack }) {
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [score, setScore] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState(null);
  const [showResult, setShowResult] = useState(false);
  const [quizComplete, setQuizComplete] = useState(false);
  const [animatedValues] = useState(
    Array(4).fill(0).map(() => new Animated.Value(0))
  );
  const [scoreAnimation] = useState(new Animated.Value(0));
  const [resultAnimation] = useState(new Animated.Value(0));

  const currentQuestion = quizData[currentQuestionIndex];
  const progress = (currentQuestionIndex + 1) / quizData.length;

  useEffect(() => {
    animateOptionsIn();
  }, [currentQuestionIndex]);

  const animateOptionsIn = () => {
    animatedValues.forEach((value, index) => {
      value.setValue(0);
      Animated.timing(value, {
        toValue: 1,
        duration: 500,
        delay: index * 100,
        useNativeDriver: true,
      }).start();
    });
  };

  const handleAnswerSelect = (optionIndex) => {
    if (selectedAnswer !== null) return;

    setSelectedAnswer(optionIndex);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    const isCorrect = optionIndex === currentQuestion.correct;
    
    if (isCorrect) {
      setScore(score + 1);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      
      // Score animation
      Animated.sequence([
        Animated.timing(scoreAnimation, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.timing(scoreAnimation, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }

    setShowResult(true);
    
    // Result animation
    Animated.timing(resultAnimation, {
      toValue: 1,
      duration: 500,
      useNativeDriver: true,
    }).start();

    // Auto-advance after showing result
    setTimeout(() => {
      handleNextQuestion();
    }, 2000);
  };

  const handleNextQuestion = () => {
    setShowResult(false);
    setSelectedAnswer(null);
    resultAnimation.setValue(0);

    if (currentQuestionIndex + 1 >= quizData.length) {
      setQuizComplete(true);
    } else {
      setCurrentQuestionIndex(currentQuestionIndex + 1);
    }
  };

  const restartQuiz = () => {
    setCurrentQuestionIndex(0);
    setScore(0);
    setSelectedAnswer(null);
    setShowResult(false);
    setQuizComplete(false);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  };

  const getOptionStyle = (index) => {
    const isSelected = selectedAnswer === index;
    const isCorrect = index === currentQuestion.correct;
    const isWrong = isSelected && !isCorrect;

    let colors = ['#43e97b', '#38f9d7']; // Default green
    
    if (showResult) {
      if (isCorrect) {
        colors = ['#00C851', '#007E33']; // Correct - bright green
      } else if (isWrong) {
        colors = ['#ff6b6b', '#ee5a52']; // Wrong - red
      } else {
        colors = ['rgba(255,255,255,0.2)', 'rgba(255,255,255,0.1)']; // Neutral
      }
    }

    return colors;
  };

  const renderOption = (option, index) => {
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

    const isSelected = selectedAnswer === index;
    const isCorrect = index === currentQuestion.correct;

    return (
      <Animated.View key={index} style={[styles.optionContainer, animatedStyle]}>
        <TouchableOpacity
          style={styles.option}
          onPress={() => handleAnswerSelect(index)}
          disabled={selectedAnswer !== null}
          activeOpacity={0.8}
        >
          <LinearGradient
            colors={getOptionStyle(index)}
            style={styles.optionGradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
          >
            <Text style={styles.optionText}>{option}</Text>
            {showResult && isCorrect && (
              <Text style={styles.checkMark}>✓</Text>
            )}
            {showResult && isSelected && !isCorrect && (
              <Text style={styles.crossMark}>✗</Text>
            )}
          </LinearGradient>
        </TouchableOpacity>
      </Animated.View>
    );
  };

  if (quizComplete) {
    const percentage = Math.round((score / quizData.length) * 100);
    let resultEmoji = '🎉';
    let resultMessage = 'Excellent!';
    
    if (percentage < 50) {
      resultEmoji = '📚';
      resultMessage = 'Keep Learning!';
    } else if (percentage < 80) {
      resultEmoji = '👍';
      resultMessage = 'Good Job!';
    }

    return (
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="light-content" />
        <LinearGradient
          colors={['#43e97b', '#38f9d7']}
          style={styles.background}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
        >
          <View style={styles.resultContainer}>
            <Text style={styles.resultEmoji}>{resultEmoji}</Text>
            <Text style={styles.resultTitle}>{resultMessage}</Text>
            <Text style={styles.finalScore}>
              You scored {score} out of {quizData.length}
            </Text>
            <Text style={styles.percentage}>{percentage}%</Text>
            
            <View style={styles.resultButtons}>
              <TouchableOpacity style={styles.restartButton} onPress={restartQuiz}>
                <Text style={styles.restartButtonText}>Play Again</Text>
              </TouchableOpacity>
              
              <TouchableOpacity style={styles.homeButton} onPress={onBack}>
                <Text style={styles.homeButtonText}>Back to Home</Text>
              </TouchableOpacity>
            </View>
          </View>
        </LinearGradient>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" />
      <LinearGradient
        colors={['#43e97b', '#38f9d7']}
        style={styles.background}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      >
        <View style={styles.header}>
          <TouchableOpacity style={styles.backButton} onPress={onBack}>
            <Text style={styles.backButtonText}>← Back</Text>
          </TouchableOpacity>
          <Text style={styles.title}>Letter Quiz!</Text>
        </View>

        <View style={styles.progressContainer}>
          <View style={styles.progressBar}>
            <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
          </View>
          <Text style={styles.progressText}>
            Question {currentQuestionIndex + 1} of {quizData.length}
          </Text>
        </View>

        <View style={styles.scoreContainer}>
          <Animated.View
            style={[
              styles.scoreDisplay,
              {
                transform: [
                  {
                    scale: scoreAnimation.interpolate({
                      inputRange: [0, 1],
                      outputRange: [1, 1.2],
                    }),
                  },
                ],
              },
            ]}
          >
            <Text style={styles.scoreText}>Score: {score}</Text>
          </Animated.View>
        </View>

        <View style={styles.questionContainer}>
          {currentQuestion.emoji && (
            <Text style={styles.questionEmoji}>{currentQuestion.emoji}</Text>
          )}
          <Text style={styles.questionText}>{currentQuestion.question}</Text>
        </View>

        <View style={styles.optionsContainer}>
          {currentQuestion.options.map((option, index) => renderOption(option, index))}
        </View>

        {showResult && (
          <Animated.View
            style={[
              styles.resultOverlay,
              {
                opacity: resultAnimation,
                transform: [
                  {
                    scale: resultAnimation.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0.8, 1],
                    }),
                  },
                ],
              },
            ]}
          >
            <Text style={styles.resultText}>
              {selectedAnswer === currentQuestion.correct ? '🎉 Correct!' : '❌ Wrong!'}
            </Text>
            {selectedAnswer !== currentQuestion.correct && (
              <Text style={styles.correctAnswerText}>
                Correct answer: {currentQuestion.options[currentQuestion.correct]}
              </Text>
            )}
          </Animated.View>
        )}
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
  progressContainer: {
    paddingHorizontal: 20,
    marginBottom: 20,
  },
  progressBar: {
    height: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
    borderRadius: 4,
    marginBottom: 10,
  },
  progressFill: {
    height: '100%',
    backgroundColor: 'white',
    borderRadius: 4,
  },
  progressText: {
    color: 'white',
    fontSize: 14,
    textAlign: 'center',
  },
  scoreContainer: {
    alignItems: 'center',
    marginBottom: 20,
  },
  scoreDisplay: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.3)',
  },
  scoreText: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
  },
  questionContainer: {
    alignItems: 'center',
    paddingHorizontal: 20,
    marginBottom: 40,
  },
  questionEmoji: {
    fontSize: 60,
    marginBottom: 20,
  },
  questionText: {
    color: 'white',
    fontSize: 20,
    fontWeight: 'bold',
    textAlign: 'center',
    lineHeight: 28,
  },
  optionsContainer: {
    paddingHorizontal: 20,
    gap: 15,
  },
  optionContainer: {
    marginBottom: 10,
  },
  option: {
    borderRadius: 15,
    overflow: 'hidden',
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
  optionGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 20,
    minHeight: 60,
  },
  optionText: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
    flex: 1,
  },
  checkMark: {
    color: 'white',
    fontSize: 24,
    fontWeight: 'bold',
  },
  crossMark: {
    color: 'white',
    fontSize: 24,
    fontWeight: 'bold',
  },
  resultOverlay: {
    position: 'absolute',
    bottom: 100,
    left: 20,
    right: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    padding: 20,
    borderRadius: 20,
    alignItems: 'center',
    elevation: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  resultText: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#38f9d7',
    marginBottom: 10,
  },
  correctAnswerText: {
    fontSize: 16,
    color: '#43e97b',
    textAlign: 'center',
  },
  resultContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  resultEmoji: {
    fontSize: 100,
    marginBottom: 20,
  },
  resultTitle: {
    fontSize: 32,
    fontWeight: 'bold',
    color: 'white',
    marginBottom: 20,
    textAlign: 'center',
  },
  finalScore: {
    fontSize: 20,
    color: 'white',
    marginBottom: 10,
    textAlign: 'center',
  },
  percentage: {
    fontSize: 48,
    fontWeight: 'bold',
    color: 'white',
    marginBottom: 40,
  },
  resultButtons: {
    gap: 15,
    width: '100%',
  },
  restartButton: {
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    paddingVertical: 15,
    borderRadius: 25,
    alignItems: 'center',
  },
  restartButtonText: {
    color: '#43e97b',
    fontSize: 18,
    fontWeight: 'bold',
  },
  homeButton: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    paddingVertical: 15,
    borderRadius: 25,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.3)',
  },
  homeButtonText: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
  },
}); 