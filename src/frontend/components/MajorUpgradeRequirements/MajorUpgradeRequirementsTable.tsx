import React from 'react';
import { MajorUpgradeRequirement } from '../../types';
import { SeverityBadge } from '../VulnerabilityTable/SeverityBadge';
import { PackageManagerBadge } from '../VulnerabilityTable/PackageManagerBadge';
import { ExclamationTriangleIcon, CodeBracketIcon, ServerIcon } from '@heroicons/react/24/outline';

interface MajorUpgradeRequirementsTableProps {
  requirements: MajorUpgradeRequirement[];
}

export const MajorUpgradeRequirementsTable: React.FC<MajorUpgradeRequirementsTableProps> = ({
  requirements
}) => {
  if (!requirements || requirements.length === 0) {
    return null;
  }

  const getUpgradeIcon = (type: string) => {
    switch (type) {
      case 'java':
        return <CodeBracketIcon className="h-4 w-4" />;
      case 'spring-boot':
        return <ServerIcon className="h-4 w-4" />;
      default:
        return <ExclamationTriangleIcon className="h-4 w-4" />;
    }
  };

  const getUpgradeTypeColor = (type: string) => {
    switch (type) {
      case 'java':
        return 'bg-orange-100 text-orange-800 border-orange-200';
      case 'spring-boot':
        return 'bg-green-100 text-green-800 border-green-200';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  return (
    <section className="mb-8">
      <div className="bg-white shadow-sm rounded-lg border border-gray-200">
        <div className="px-6 py-4 border-b border-gray-200 bg-orange-50">
          <div className="flex items-center">
            <ExclamationTriangleIcon className="h-6 w-6 text-orange-600 mr-3" />
            <div>
              <h3 className="text-lg font-semibold text-gray-900">
                Java and Spring Major Version Upgrade Required
              </h3>
              <p className="text-sm text-gray-600 mt-1">
                The following dependencies require major version upgrades that are incompatible with your current environment. 
                Consider upgrading your Java/Spring versions to apply these security fixes.
              </p>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Component
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Versions
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Required Upgrades
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Reason
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  CVEs
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  JIRA Tickets
                </th>
                <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Severity
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {requirements.map((requirement, index) => (
                <tr
                  key={requirement.id}
                  className="hover:bg-gray-50"
                >
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex flex-col">
                      <div className="flex items-center">
                        <PackageManagerBadge manager={requirement.packageManager} />
                        <div className="ml-3">
                          <div className="text-sm font-medium text-gray-900">
                            {requirement.dependencyName}
                          </div>
                          <div className="text-sm text-gray-500">
                            {requirement.filePath}
                          </div>
                        </div>
                      </div>
                    </div>
                  </td>
                  
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm">
                      <span className="text-red-600 font-medium">{requirement.currentVersion}</span>
                      <span className="text-gray-400 mx-2">→</span>
                      <span className="text-green-600 font-medium">{requirement.recommendedVersion}</span>
                    </div>
                  </td>

                  <td className="px-6 py-4">
                    <div className="space-y-2">
                      {requirement.requiredUpgrades.map((upgrade, idx) => (
                        <div
                          key={idx}
                          className={`inline-flex items-center px-2 py-1 rounded-md text-xs font-medium border ${getUpgradeTypeColor(upgrade.type)}`}
                        >
                          {getUpgradeIcon(upgrade.type)}
                          <span className="ml-1">
                            {upgrade.current} → {upgrade.required}
                          </span>
                        </div>
                      ))}
                    </div>
                  </td>

                  <td className="px-6 py-4">
                    <div className="text-sm text-gray-700">
                      {requirement.reason}
                    </div>
                  </td>

                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="space-y-1">
                      {requirement.cveIds.map((cveId, idx) => (
                        <div key={idx} className="text-sm font-mono text-gray-700 bg-gray-100 px-2 py-1 rounded">
                          {cveId}
                        </div>
                      ))}
                    </div>
                  </td>

                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="space-y-1">
                      {requirement.jiraTickets.map((ticket, idx) => (
                        <div key={idx} className="text-sm font-mono text-blue-600 bg-blue-100 px-2 py-1 rounded">
                          {ticket}
                        </div>
                      ))}
                    </div>
                  </td>

                  <td className="px-6 py-4 whitespace-nowrap text-center">
                    <SeverityBadge severity={requirement.severity} size="sm" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="px-6 py-4 bg-gray-50 border-t border-gray-200">
          <div className="text-sm text-gray-600">
            <p className="mb-2">
              <strong>Next Steps:</strong>
            </p>
            <ul className="list-disc list-inside space-y-1 text-xs">
              <li>Review the required version upgrades and assess the impact on your application</li>
              <li>Plan a maintenance window for upgrading Java/Spring versions</li>
              <li>Test the application thoroughly after major version upgrades</li>
              <li>Re-run the vulnerability analysis after upgrades to apply the security fixes</li>
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
};