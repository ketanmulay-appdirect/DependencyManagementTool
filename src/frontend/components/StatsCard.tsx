import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { InformationCircleIcon } from '@heroicons/react/24/outline';

// Simple Tooltip Component
interface TooltipProps {
  content: string;
  children: React.ReactNode;
}

const Tooltip: React.FC<TooltipProps> = ({ content, children }) => {
  const [isVisible, setIsVisible] = useState(false);

  return (
    <div className="relative inline-block">
      <div
        onMouseEnter={() => setIsVisible(true)}
        onMouseLeave={() => setIsVisible(false)}
      >
        {children}
      </div>
      {isVisible && (
        <div className="absolute z-50 px-3 py-2 text-sm text-white bg-gray-900 rounded-lg shadow-lg -top-2 left-full ml-2 w-64">
          <div className="relative">
            {content}
            {/* Arrow pointing left */}
            <div className="absolute top-1/2 -left-1 transform -translate-y-1/2 w-2 h-2 bg-gray-900 rotate-45"></div>
          </div>
        </div>
      )}
    </div>
  );
};

interface StatsCardProps {
  title: string;
  value: number;
  icon: React.ComponentType<{ className?: string }>;
  color: 'blue' | 'red' | 'green' | 'yellow' | 'purple' | 'indigo' | 'orange';
  subtitle?: string;
  tooltip?: string;
  trend?: {
    value: number;
    isPositive: boolean;
  };
}

export const StatsCard: React.FC<StatsCardProps> = ({
  title,
  value,
  icon: Icon,
  color,
  subtitle,
  tooltip,
  trend,
}) => {
  const colorClasses = {
    blue: {
      bg: 'bg-blue-50',
      icon: 'text-blue-600',
      text: 'text-blue-900',
    },
    red: {
      bg: 'bg-red-50',
      icon: 'text-red-600',
      text: 'text-red-900',
    },
    green: {
      bg: 'bg-green-50',
      icon: 'text-green-600',
      text: 'text-green-900',
    },
    yellow: {
      bg: 'bg-yellow-50',
      icon: 'text-yellow-600',
      text: 'text-yellow-900',
    },
    purple: {
      bg: 'bg-purple-50',
      icon: 'text-purple-600',
      text: 'text-purple-900',
    },
    indigo: {
      bg: 'bg-indigo-50',
      icon: 'text-indigo-600',
      text: 'text-indigo-900',
    },
    orange: {
      bg: 'bg-orange-50',
      icon: 'text-orange-600',
      text: 'text-orange-900',
    },
  };

  const colors = colorClasses[color];

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="card"
    >
      <div className="flex items-center">
        <div className={`flex-shrink-0 p-3 ${colors.bg} rounded-lg`}>
          <Icon className={`h-6 w-6 ${colors.icon}`} />
        </div>
        <div className="ml-4 flex-1">
          <div className="flex items-center space-x-2">
            <p className="text-sm font-medium text-gray-500">{title}</p>
            {tooltip && (
              <Tooltip content={tooltip}>
                <InformationCircleIcon className="h-4 w-4 text-gray-400 hover:text-gray-600 cursor-help" />
              </Tooltip>
            )}
          </div>
          <div className="flex items-baseline">
            <p className={`text-2xl font-semibold ${colors.text}`}>
              {value.toLocaleString()}
            </p>
            {trend && (
              <span
                className={`ml-2 text-sm ${
                  trend.isPositive ? 'text-green-600' : 'text-red-600'
                }`}
              >
                {trend.isPositive ? '↗' : '↘'} {Math.abs(trend.value)}%
              </span>
            )}
          </div>
          {subtitle && (
            <p className="text-sm text-gray-600 mt-1">{subtitle}</p>
          )}
        </div>
      </div>
    </motion.div>
  );
}; 