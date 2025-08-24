import React, { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { 
  ExclamationTriangleIcon,
  InformationCircleIcon,
  LinkIcon,
  ShieldExclamationIcon,
  XMarkIcon
} from '@heroicons/react/24/outline';
import { SeverityBadge } from '../VulnerabilityTable/SeverityBadge';
import type { FalsePositive } from '../../types';

interface FalsePositivesTableProps {
  falsePositives: FalsePositive[];
}

// Helper function to clean description and extract key information (matches VulnerabilityTable format)
const cleanDescription = (rawDescription: string): string => {
  if (!rawDescription) return 'Security Vulnerability';
  
  // Extract component information from JIRA markdown
  const componentMatch = rawDescription.match(/\*?Component\*?:\s*([^\n\r*]+)/i);
  const component = componentMatch?.[1]?.replace(/\*/g, '').trim();
  
  if (component) {
    return `Component: ${component}`;
  }
  
  // Fallback to clean CVE extraction or generic message
  const cveMatch = rawDescription.match(/CVE-\d{4}-\d{4,}/);
  if (cveMatch) {
    return `Security Vulnerability: ${cveMatch[0]}`;
  }
  
  return 'Security Vulnerability';
};

type SortField = 'severity' | 'title';
type SortDirection = 'asc' | 'desc';

export const FalsePositivesTable: React.FC<FalsePositivesTableProps> = ({
  falsePositives,
}) => {
  const [sortField, setSortField] = useState<SortField>('severity');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [filterSeverity, setFilterSeverity] = useState<string>('all');

  const severityOrder = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };

  const sortedFalsePositives = useMemo(() => {
    const safeFalsePositives = Array.isArray(falsePositives) ? falsePositives : [];
    
    return [...safeFalsePositives].sort((a, b) => {
      let comparison = 0;
      
      switch (sortField) {
        case 'severity':
          comparison = severityOrder[b.severity] - severityOrder[a.severity];
          break;
        case 'title':
          comparison = a.title.localeCompare(b.title);
          break;
        default:
          comparison = 0;
      }
      
      return sortDirection === 'asc' ? comparison : -comparison;
    });
  }, [falsePositives, sortField, sortDirection]);

  const filteredFalsePositives = useMemo(() => {
    if (filterSeverity === 'all') return sortedFalsePositives;
    return sortedFalsePositives.filter(fp => fp.severity === filterSeverity);
  }, [sortedFalsePositives, filterSeverity]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  const SortButton: React.FC<{ field: SortField; children: React.ReactNode }> = ({ field, children }) => (
    <button
      onClick={() => handleSort(field)}
      className="flex items-center space-x-1 text-left hover:text-blue-600 transition-colors"
    >
      <span>{children}</span>
      {sortField === field && (
        sortDirection === 'asc' ? 
          <span className="text-xs">↑</span> : 
          <span className="text-xs">↓</span>
      )}
    </button>
  );

  if (!falsePositives || falsePositives.length === 0) {
    return (
      <div className="bg-green-50 border border-green-200 rounded-lg p-6">
        <div className="flex items-center">
          <ShieldExclamationIcon className="h-5 w-5 text-green-600 mr-2" />
          <div className="text-sm text-green-800">
            <strong>No False Positives Found</strong>
            <p className="mt-1">All vulnerability tickets correctly match dependencies in this repository.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <ExclamationTriangleIcon className="h-5 w-5 text-orange-500" />
          <h3 className="text-lg font-semibold text-gray-900">
            False Positives ({falsePositives.length})
          </h3>
          <div className="group relative">
            <InformationCircleIcon className="h-4 w-4 text-gray-400 hover:text-gray-600 cursor-help" />
            <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-2 bg-gray-900 text-white text-xs rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-200 whitespace-nowrap z-10 pointer-events-none">
              VM tickets that don't affect any dependencies in this repository
              <div className="absolute top-full left-1/2 transform -translate-x-1/2 w-2 h-2 bg-gray-900 rotate-45 -mt-1"></div>
            </div>
          </div>
        </div>

        <select
          value={filterSeverity}
          onChange={(e) => setFilterSeverity(e.target.value)}
          className="px-3 py-1 border border-gray-300 rounded-md text-sm focus:ring-blue-500 focus:border-blue-500"
        >
          <option value="all">All Severities</option>
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
          <option value="info">Info</option>
        </select>
      </div>

      {/* Table */}
      <div className="overflow-x-auto bg-white shadow-sm rounded-lg border border-gray-200">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                <SortButton field="severity">Severity</SortButton>
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                <SortButton field="title">Vulnerability</SortButton>
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Missing Dependencies
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Reason
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {filteredFalsePositives.map((falsePositive, index) => (
              <motion.tr
                key={falsePositive.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: index * 0.05 }}
                className="hover:bg-gray-50"
              >
                <td className="px-6 py-4 whitespace-nowrap">
                  <SeverityBadge severity={falsePositive.severity} />
                </td>
                <td className="px-6 py-4">
                  <div className="max-w-sm">
                    <div className="font-medium text-gray-900 text-sm font-mono mb-2">
                      {falsePositive.cveId || falsePositive.title}
                    </div>
                    <div className="text-xs text-gray-700 font-medium">
                      {cleanDescription(falsePositive.description)}
                    </div>
                    {falsePositive.jiraTicket && (
                      <a
                        href={`https://appdirect.jira.com/browse/${falsePositive.jiraTicket.key}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-blue-600 hover:text-blue-700 inline-flex items-center mt-2"
                      >
                        <LinkIcon className="h-3 w-3 mr-1" />
                        {falsePositive.jiraTicket.key}
                      </a>
                    )}
                  </div>
                </td>
                <td className="px-6 py-4">
                  <div className="max-w-xs space-y-1">
                    {falsePositive.missingPackages.slice(0, 3).map((pkg, i) => (
                      <div key={i} className="text-sm">
                        <div className="flex items-center space-x-2">
                          <XMarkIcon className="h-3 w-3 text-red-500" />
                          <span className="font-mono text-gray-700 text-xs">{pkg}</span>
                        </div>
                      </div>
                    ))}
                    {falsePositive.missingPackages.length > 3 && (
                      <div className="text-xs text-gray-500 italic">
                        +{falsePositive.missingPackages.length - 3} more
                      </div>
                    )}
                  </div>
                </td>
                <td className="px-6 py-4">
                  <div className="text-sm text-gray-700">
                    <div className="flex items-center space-x-2">
                      <ExclamationTriangleIcon className="h-4 w-4 text-orange-500" />
                      <span>{falsePositive.reason}</span>
                    </div>
                  </div>
                </td>
              </motion.tr>
            ))}
          </tbody>
        </table>
      </div>

      {filteredFalsePositives.length === 0 && falsePositives.length > 0 && (
        <div className="text-center py-8 text-gray-500">
          <ExclamationTriangleIcon className="h-8 w-8 mx-auto mb-2 text-gray-400" />
          <p>No false positives match the selected severity filter.</p>
        </div>
      )}
    </div>
  );
}; 